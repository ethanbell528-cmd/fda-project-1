# Intro night environment (HDRI)

- File: `moonless_golf_1k.hdr` (1.6 MB)
- Source: three.js GitHub examples,
  `examples/textures/equirectangular/moonless_golf_1k.hdr`
  (<https://github.com/mrdoob/three.js/tree/dev/examples/textures/equirectangular>)
- License: three.js is MIT licensed; this HDRI ships with its examples.
- Use: image-based lighting for the night-game intro stadium in
  `js/intro3d.js`. It loads lazily after the first frame and only replaces
  the built-in RoomEnvironment lighting when present, so the intro looks
  the same (minus richer reflections) if the file is missing.
- Verified: HTTP 200 from raw.githubusercontent.com, 1672754 bytes.
