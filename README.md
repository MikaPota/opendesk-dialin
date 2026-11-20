# Phone dial-in for openDesk meetings with the Vodia PBX

Callers join openDesk video meetings (Jitsi) from any phone: they dial a number on
the Vodia PBX, enter the meeting PIN, and the PBX hands the call to openDesk's
Jigasi with the meeting's room name. This is the Vodia counterpart of
[nordeck/jigasi-recepta](https://github.com/nordeck/jigasi-recepta), the
FreeSWITCH reference that openDesk's `sip.yaml.gotmpl` points to.

Tested end to end on Vodia PBX 70.6 (2026-11-20): PIN entered as telephone
digits, conference mapper asked, and the call forwarded with
`Jitsi-Conference-Room: <room>@conference.<domain>`. The test stood in for
Jigasi and the mapper; the test against a real openDesk instance is still to do.

## How it works

```
Caller ── DID ──▶ Vodia IVR node (ivr-dialin.js)
                    │ 1. asks for the PIN
                    │ 2. GET <conference mapper>?id=<PIN>  →  {"conference": "room@conference.<domain>"}
                    │ 3. call.transfer("room")
                    ▼
                  Dial plan "Jigasi": pattern *  →  trunk "Jigasi"
                    ▼
                  Trunk "Jigasi" (SIP gateway, TCP) adds
                  Jitsi-Conference-Room: room@conference.<domain>
                    ▼
                  openDesk Jigasi  ──▶  the meeting
```

Jigasi takes the room **only** from that INVITE header. Vodia's IVR scripts
cannot set SIP headers, so the script dials the room's name and the trunk
writes the header from it.

## Requirements

**openDesk** (operator):

- Jigasi enabled (`sip.jigasi.enabled: true`); its account settings
  (`server`, `uri`, `password`) may point at the Vodia PBX, but the dial-in
  does not rely on the registration.
- **Jigasi's SIP port (5060/TCP) reachable from the Vodia PBX at a fixed
  address**, for example a Kubernetes `LoadBalancer` or `NodePort` service in
  front of the Jigasi pod, limited to the PBX's IP address. openDesk does not
  expose it by default.
- The conference mapper reachable from the PBX over HTTPS, and the dial-in
  number shown in Jitsi (`jitsi.web.extraConfig.dialinPhoneNumbers`).

**Vodia PBX**: a tenant with one IVR node, one trunk and one dial plan, and a
DID (phone number) that routes to the IVR node.

## Setup on the Vodia PBX

All in the tenant that owns the dial-in number.

1. **Trunk "Jigasi"**: type *SIP Gateway* (no registration).
   - *Proxy address*: `sip:<Jigasi's public address>:5060;transport=tcp`
   - *Domain*: `<Jigasi's public address>:5060`
   - *Customer specific header*:
     `Jitsi-Conference-Room: {local-uri-number}@conference.<openDesk domain>`
   - Direction: outbound only is enough.
2. **Dial plan "Jigasi"**: one entry, preference `100`, trunk `Jigasi`,
   pattern `*`, replacement empty.
3. **IVR node** (for example `800`): *Type* JavaScript, script
   [`ivr-dialin.js`](ivr-dialin.js) with `MAPPER_URL` set to openDesk's
   conference mapper; *Dial plan* `Jigasi`.
4. **The dial-in number** routes to the IVR node (the DID's trunk sends it to
   `800`).

The same settings over the PBX's REST API, as used in the test:

| What | Request |
|---|---|
| IVR node | `POST /rest/domain/<tenant>/addacc/800` `{"type":"ivrnodes","account":"800"}` |
| Script | `POST /rest/ivrnode/800@<tenant>/webtempl?name=ivrnode.js` `{"content":"<script>"}` |
| Trunk | `POST /rest/domain/<tenant>/domain_trunks` `{"type":"gateway","name":"Jigasi"}`, then `POST …/edit_trunk/<id>` with `outbound_proxy`, `reg_registrar`, `user_defined_hdr` |
| Dial plan | `POST …/dialplans` `{"name":"Jigasi"}`, then `POST …/edit_dialplan?dialplan=<id>` `{"dps":[{"preference":"100","trunk":"<id>","pattern":"*","replacement":""}]}` |
| Use it | `POST …/user_settings/800` `{"dial_plan":"<id>"}` |

## Details that matter

- **Tag:** use `{local-uri-number}` (the dialed room name). `{to-user}` is
  the destination of the *original* call, the IVR's own number, and does not work.
- **Room names:** the script dials only the part before `@` and accepts
  letters, digits, `.`, `_` and `-`. The trunk adds the MUC domain, which is
  therefore fixed per tenant (one tenant per openDesk instance).
- **Request-URI:** the INVITE's Request-URI still names the IVR
  (`sip:800@<tenant>`). Jigasi ignores it; set the trunk's Request-URI header
  if a proxy in between needs the room there.
- **PIN entry:** up to 10 digits, `#` ends, 20 s per attempt, 3 attempts, as
  in jigasi-recepta. Prompts are spoken by the PBX's text-to-speech in German
  and English; replace `TEXT` in the script for other languages.

## License

Apache-2.0, like jigasi-recepta.
