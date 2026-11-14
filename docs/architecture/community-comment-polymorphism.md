# Community Comment Polymorphism

Status: Implemented in #165 against ADR-0009.

## Decision

The existing Comment primitive safely supports Discussion targets.

The canonical target discriminator is now:

- ISSUE
- WIKI
- DISCUSSION

The existing compound index on:

    { refType: 1, refId: 1 }

remains sufficient for target-thread reads.

No parallel DiscussionComment collection is introduced.

## Preserved invariants

The existing Comment behavior remains shared across all three target types:

1. refType identifies the target domain.
2. refId identifies the target document.
3. A reply must use the exact same refType and refId as its parent.
4. A reply cannot itself receive a reply.
5. Existing ISSUE and WIKI behavior remains unchanged.

The Discussion target therefore uses the same persistence and reply model rather
than introducing a second conversation implementation.

## Authorization and visibility

Comment creation remains authenticated through the existing requireActor()
service boundary.

The target must exist before a Comment can be created.

For public Comment reads:

- ISSUE remains publicly readable under its existing public-read contract.
- WIKI remains publicly readable only when the Knowledge article is approved.
- DISCUSSION is publicly readable only while the Discussion is ACTIVE.

A hidden Discussion and a nonexistent Discussion share the same public
TARGET_NOT_FOUND boundary. This prevents GET /api/v1/comments from becoming a
visibility side channel.

The concrete moderation rules for who may hide/unhide a Discussion and what
happens to comments when that occurs remain owned by #167.

## Verification

Focused tests cover:

- top-level Discussion comments;
- same-target Discussion replies;
- cross-Discussion reply rejection;
- ISSUE -> DISCUSSION cross-target rejection;
- reply-to-reply rejection;
- public ACTIVE Discussion threads;
- hidden Discussion thread suppression;
- nonexistent Discussion target behavior;
- HTTP POST/GET support for DISCUSSION;
- preservation of the existing validation boundary for unsupported refType.

The existing ISSUE/WIKI comment test suites remain unchanged and continue to
exercise their original behavior.

## Non-goals

- Discussion moderation/reporting implementation (#167)
- Community Activity aggregation (#166)
- frontend Comment type/UI changes (#12)
- deeper threading
- social features
