# Reviews surface integration

Merge `ui-contracts.fragment.json` into the shared UI manifest: append `features`,
merge `routes`, and remove both exact entries listed in `removeLegacyRoutes` from
`legacyRoutes`. `tests/reviews-ui-contract.test.ts` checks this merge in memory
against the full production graph and copy policy. The unmerged stock policy
correctly reports eight unregistered review presentation/surface files.

## Presentations and lifetime

- Inbox: phone single column with expandable source/filter controls; tablet source
  rail and filtered list; desktop source, filters and list in separate columns.
- Detail: phone active reading item and expandable item selector; tablet navigator
  and reading column; desktop navigator, reading content and evidence column.
- Detail presentation selection changes only the navigation region. Its surface
  marker selects the stable surrounding grid. Reading and evidence hosts are
  siblings, never children of the three interchangeable navigation trees. This is
  deliberate: rendering stateful content as a slot inside each alternate page
  would remount forms, feedback and polling.
- `ReviewWorkspace.hooks.ts` owns source discovery, filters, listing, generation
  guards and pinned opening. `ReviewPacket.hooks.ts` owns member preload, preview
  selection, per-member comparison mode and document Zen, including the
  preview-to-restored-session transition.
- `ReviewSession.hooks.ts` owns answers/choice notes, active member, progress,
  feedback queue, recovery, save state and uncertain-write identity.
  `ReviewForm.hooks.ts` owns the active form's step/Zen state on its stable host.
  `ReviewProcess.hooks.ts` and `ReviewWorkflow.hooks.ts` retain evidence fetching
  and workflow polling on stable evidence hosts.
- Exact request ID/version/snapshot define the packet lifetime. Reviewer identity
  additionally defines the restored session lifetime. Resizing changes neither.
- The source expansion and navigator expansion are presentation-local disclosure
  preferences; source values, filters and review data survive presentation swaps.

`navigation.ts` supplies pure `ReviewLocation`, `parseReviewSearch` and
`reviewHref`; compatibility exports remain on `ReviewWorkspace.tsx`.
`model.ts` retains status/response/link semantics for the subsequent Reviews Home.
`RoutedReviews` opts into the parent's unified navigation. Standalone fixtures
retain a Review inbox link.

## Verification entry points

- `ReviewsInboxSurfaces.stories.tsx`: six fixed orientations plus Adaptive.
- `ReviewsDetailSurfaces.stories.tsx`: six fixed orientations plus Adaptive.
- `review-surfaces.spec.ts`: all twelve production scenarios, real-host resize
  survival, source/filter retention without body prefetch, uncertain-write
  reconciliation, polling lifetime and access revocation.
- Existing `reviews.spec.ts`, `review-storage-picker.spec.ts` and
  `review-process.spec.ts`: draft/receipt restoration, pinned fast preview,
  separate feedback intake, delivery, recovery and source discovery regressions.

Browser verification uses Chromium emulation at port 4043 with separate outputs.
Physical-device keyboard/OS/WebView acceptance and shared browser project
registration belong to parent integration.
