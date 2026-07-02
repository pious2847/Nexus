# Spec 02 — Life-Critical & Unique Features (proposals)

> Features **not** in the original catalog that a system of this nature *needs* because
> **lives depend on it**. Curated for high impact + fit to Ghana's realities (networks &
> power fail during disasters; many people have low literacy or no smartphone; community
> radio and human messengers still rule the last mile; response is multi-agency).
>
> Proposed as a new **Module N — Life-Safety & Resilience**, plus enhancements to existing
> modules (F alerts, M response, B EWS). Parent: [MASTER_PLAN.md](../MASTER_PLAN.md).
>
> **Date:** 2026-07-02 · **Status:** proposal for your review

---

## Why this matters
Warnings and dashboards are necessary but not sufficient. What actually saves lives is:
**getting the right person the right message they trust, in time, and helping them act —
even when the internet is down.** These features close that gap. Each below lists *what it
is*, *why lives depend on it*, and *where it plugs in*.

---

## Theme 1 — Two-way life safety (people, not just data)

### N1. "I'm Safe" safety check-in ⭐
- **What:** after an event, people mark themselves **Safe / Need Help / Injured** in one tap (PWA), by SMS reply, or via a community focal person on their behalf. Aggregated live per locality.
- **Why lives depend on it:** responders instantly see *who is unaccounted for* and where to search — instead of searching everywhere blindly. Families get peace of mind; rumors drop.
- **Plugs into:** Module F (triggered by an alert), Module M (feeds dispatch priorities), live map.

### N2. SOS / panic button ⭐
- **What:** a citizen in immediate danger sends an **SOS with live GPS** (trapped in flood, fire, medical). Creates a high-priority incident on the response board.
- **Why:** minutes matter in drowning/fire/medical emergencies; a precise location turns a rescue from hours to minutes.
- **Plugs into:** Module M (auto-creates dispatch task), Module C (report), nearest-responder routing (N7).

### N3. Missing persons & family reunification
- **What:** report a missing person; match against "I'm Safe" check-ins and shelter registrations; reunification board (esp. separated children).
- **Why:** family separation — especially children — is one of the cruelest, most common disaster harms; structured matching reunites families fast and protects unaccompanied minors (UNICEF-aligned).
- **Plugs into:** N1, Module M shelters (who checked in where).

---

## Theme 2 — Protect the most vulnerable (before it hits)

### N4. Vulnerable persons registry (pre-disaster) ⭐
- **What:** map **who needs help to evacuate** *before* disaster strikes — elderly, persons with disabilities, pregnant women, chronically ill, unaccompanied children, bedridden — by household/community, with consent + privacy controls.
- **Why lives depend on it:** these are the people who die first because they can't self-evacuate. Knowing *in advance* who and where lets responders reach them first. This is a hallmark of mature EWS and a genuine differentiator.
- **Plugs into:** Module A (geo/consent), Module M (evacuation prioritization), impact-based forecasting (B §9).

### N5. Accessibility & no-literacy alerting
- **What:** warnings as **pictograms/icons, color, and audio/voice** (not just text) — deaf, blind, and non-reading users included. Voice in local languages (Arkesel supports Twi/Hausa/Ewe).
- **Why:** a warning nobody can read or hear is not a warning. Inclusion here is literally life-or-death for a large share of the population.
- **Plugs into:** Module F (channel rendering), i18n, Arkesel voice.

---

## Theme 3 — Get people to safety (the last mile)

### N6. Last-mile community alerting (beyond phones) ⭐
- **What:** reach people **without smartphones or signal** — integrations/workflows for **community radio stations** (auto-format alerts for broadcast), **sirens/PA/loud-hailers**, digital **town-crier / gong-gong** dispatch to registered **community focal persons** who alert door-to-door, and printable **community notice-board** sheets.
- **Why lives depend on it:** in rural Ghana the fastest reliable channel is often the local FM station or a trusted person shouting through the town — not an app. Ignoring this leaves the most exposed people uninformed.
- **Plugs into:** Module F (as delivery channels), community moderators (Module C), Arkesel voice/USSD.

### N7. Dynamic evacuation routing & nearest safe place ⭐
- **What:** "**Go here, this way**" — route a person to the **nearest open shelter/high ground**, actively **avoiding** flooded/on-fire road segments, using PostGIS + `pgrouting` (confirmed available on Neon). Works offline with cached maps.
- **Why:** people die taking familiar routes straight into the hazard. Guided safe routing + shelter capacity awareness (don't send 500 people to a full shelter) saves lives.
- **Plugs into:** Module M (shelters/capacity), Module H (map), Module B (hazard geometry to avoid).

---

## Theme 4 — A system that does not fail when it matters most

### N8. Resilient / degraded-mode operation ⭐⭐ (non-negotiable for life-safety)
- **What:** the platform keeps issuing and delivering warnings when **internet or power fails** — SMS/USSD/voice paths independent of the app; **district EOC offline nodes** that cache alerts and sync later; graceful degradation if a data source or the cloud is unreachable.
- **Why lives depend on it:** disasters *cause* the very outages that take normal systems down. A warning system that dies with the network is worthless exactly when needed. Design for failure from day one.
- **Plugs into:** architecture (multi-path delivery), Module F, offline PWA, ops.

### N9. Guaranteed & acknowledged alert delivery ⭐
- **What:** critical alerts use **retries, multi-channel escalation, and acknowledgment tracking** — if push isn't confirmed, fall back to SMS, then voice call; officials must **acknowledge** receipt; dashboard shows *who got it and who didn't*.
- **Why:** "we sent it" ≠ "they received it." Confirmation + escalation closes the deadly gap between dispatch and receipt.
- **Plugs into:** Module F (delivery engine), Module N1 (two-way), analytics.

### N10. Alert authentication / anti-spoofing ⭐
- **What:** official alerts are **digitally signed / verifiable** ("Verified · NEXUS/NADMO"); public can confirm an alert is genuine; tamper-evident.
- **Why lives depend on it:** **fake disaster alerts cause deadly panic and stampedes**, and erode trust so real warnings get ignored. Authenticity is a safety feature.
- **Plugs into:** Module F, CAP signing, Module N11.

### N11. Rumor & misinformation control
- **What:** a **"report a rumor"** intake + an official **myth-vs-fact** feed pushed on the same channels as alerts; rapid official clarification.
- **Why:** in every disaster, misinformation spreads faster than facts and gets people killed (wrong routes, false all-clears). Actively countering it is life-saving.
- **Plugs into:** Module F, Module J (AI triage of rumor reports), Module C.

---

## Theme 5 — Act *before* impact (the prevention promise, operationalized)

### N12. Anticipatory action / forecast-based triggers ⭐⭐ (cutting-edge, high-value)
- **What:** pre-agreed **"if forecast crosses X, then automatically do Y"** protocols — pre-position relief, pre-alert focal persons, stage evacuation of vulnerable (N4), release standby funds — *before* the hazard hits. (Known in humanitarian practice as **anticipatory action / forecast-based financing**.)
- **Why lives depend on it:** acting on a forecast 24–72h out prevents deaths and cuts response cost dramatically vs. reacting after. This is the concrete engine behind your "predict and prevent" mission.
- **Plugs into:** Module B (triggers), Module M (pre-positioning), Module F (pre-alerts), Module N4.

### N13. Drills, simulation & test mode
- **What:** run **exercises** (clearly labeled TEST) to train communities and validate the whole chain — alerts, check-ins, routing, dispatch — without causing real panic. Extends the existing demo simulator into a real preparedness tool.
- **Why:** an untested warning chain fails on the day. Regular drills are proven to cut disaster deaths; they also onboard citizens to how the system works.
- **Plugs into:** Module L (simulator), all channels (with TEST flag), analytics (drill performance).

---

## Theme 6 — Command, response & recovery (multi-agency reality)

### N14. Common Operating Picture + Incident Command ⭐
- **What:** a unified **command-center view** during an active event (all hazards, reports, resources, tasks, check-ins on one screen) with lightweight **Incident Command System (ICS)** roles — who's in charge, chain of command across NADMO/GMet/GHS/Fire/Police.
- **Why:** multi-agency responses fail from fragmented information and unclear command. One shared picture + clear roles = faster, coordinated action = lives saved.
- **Plugs into:** Module M, Module K, Module B, real-time.

### N15. Rapid damage & needs assessment
- **What:** structured **post-event** assessment (households affected, casualties, damaged infrastructure, urgent needs) via mobile forms, offline-capable, geo-tagged; auto-rolls up to a situation report.
- **Why:** aid flows to *measured* need; fast, structured assessment gets help (and funding) to the worst-hit first — and becomes high-value historical/exportable data.
- **Plugs into:** Module C (forms), Module M, Module G (datasets), Module K (sitreps).

### N16. Health-facility capacity & mass-casualty coordination
- **What:** live **hospital/clinic bed, blood, and ambulance** availability during emergencies; route casualties to facilities with capacity.
- **Why:** in floods/fires/outbreaks, sending casualties to a full or cut-off facility costs lives; real-time capacity routing saves them.
- **Plugs into:** Module D (facilities), Module M (dispatch), N7 (routing).

---

## Suggested prioritization (life-saving impact vs. effort)
**Tier 1 — build into the core early (highest life-saving leverage):**
N8 resilient/degraded mode · N9 guaranteed+ack delivery · N6 last-mile community alerting ·
N4 vulnerable persons registry · N1 "I'm Safe" · N10 signed alerts.

**Tier 2 — high value, next:**
N7 evacuation routing · N2 SOS · N12 anticipatory action · N5 accessibility · N14 COP/ICS.

**Tier 3 — important, later:**
N3 missing persons · N11 rumor control · N13 drills · N15 damage assessment · N16 hospital capacity.

> **Cross-cutting truth:** N8 + N9 (resilience + guaranteed delivery) should be treated as
> **foundational**, not features — everything else assumes the warning actually arrives.

---

## Recommendation
Adopt these as **Module N — Life-Safety & Resilience** in the master plan, with N8/N9
folded into the alerts/architecture foundation. They're what elevate NEXUS from a very good
*monitoring & data* platform to a genuine *life-saving* one — and several (vulnerable-persons
registry, anticipatory action, "I'm Safe", last-mile human network) are exactly the features
that impress government/UNICEF because they show the system is built around **people at risk**,
not just dashboards.
