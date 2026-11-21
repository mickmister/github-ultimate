# Native UI

Native deployment, connection/credential, grant, cache and diagnostic settings stay
in this app. Hosted UI may request Open native settings but must not reproduce or
embed those screens. Preserve document authorization/revocation and pending-operation
identities when opening settings or returning to the retained WebView.

Assess phone/tablet portrait and landscape, split-screen, software/hardware keyboard,
OS Back and background/resume for each UI change. Hosted content additionally has
an explicit desktop implementation. Do not create a desktop native app or infer
device acceptance from compilation. Follow the feature hooks/model/view and concise
copy principles in `../webapp/AGENTS.md`; do not add empty hooks files for pure leaves.

Run native types and targeted tests plus `pnpm run lint:ui` from the repository root
before a native build/OTA publication. Static pilot coverage currently enforces the
hosted Documents feature, not every native Text/StyleSheet construct. Accurately
record remaining physical-device evidence and existing transport owners. Never
solve helper-copy clutter by hiding essential permissions, errors or accessible names.
