# AI-generated intro clip, v2 (preview page `intro-preview.html?clip=ai2`)

This clip is **AI-generated**. It is not real footage and the player is not a real person; the page
labels it "AI-generated video, not a real player (Wan 2.2 T2V-A14B)".

- Model: Wan 2.2 text-to-video A14B (`Wan-AI/Wan2.2-T2V-A14B-Diffusers`), Apache-2.0 license
  (<https://huggingface.co/Wan-AI/Wan2.2-T2V-A14B-Diffusers>). Apache-2.0 places no restriction
  on publishing the output.
- Hosted on the public Hugging Face Space `Upsampler/wan-2-2-14b-text-to-video`
  (<https://huggingface.co/spaces/Upsampler/wan-2-2-14b-text-to-video>), run anonymously on
  2026-09-26. The Space runs the model in fp8, compiled ahead of time, with the Lightx2v 4-step
  CFG/step-distill speed-up LoRA fused in. It loads that LoRA from `Kijai/WanVideo_comfy`, whose Hub
  repo has no license tag (not checked further).
- Settings: aspect ratio "16:9 (832x480)", duration 5.0 s (the Space maximum: 81 frames at 16 fps,
  5.06 s, no audio), 4 steps, guidance_scale 1 and guidance_scale_2 1, seed 2601 (fixed,
  randomize_seed off).
- Prompt: "Photorealistic cinematic shot of a college football scrimmage at night. A quarterback in a
  plain white jersey with a dark gray number 8, matte gray helmet with no decals, gray pants, black
  cleats, takes the snap, drops back three steps, sets his feet and throws a tight spiral straight
  toward the camera; the spinning football leaves his hand and flies at the lens. Low field-level
  camera, bright stadium floodlights, blurred crowd, light haze, shallow depth of field, 24fps film
  look."
- Negative prompt (sent, but guidance 1 skips classifier-free guidance, so it had no effect):
  "celebrity, famous athlete, real person likeness, deformed hands, extra fingers, two balls, ball
  stuck to hand, frozen ball, cartoon, CGI, video game, blurry face, flicker".
- Changes: re-encoded with FFmpeg as all-intra H.264 (CRF 20) and VP9 (CRF 30) for scroll scrubbing
  (`qb-ai2-720.*` at 832 px, `qb-ai2-480.*` at 640 px), audio removed. Stills: `qb-ai2-poster.jpg`
  (frame 0), `qb-ai2-still.jpg` (frame 58, reduced-motion fallback) and `qb-ai2-release.jpg`
  (frame 67, the hand-off frame the page holds while the 3D football takes over).
- Known issues: the clip opens mid drop-back (no snap); the real ball leaves through the top of the
  frame instead of flying at the lens, so the page stops on frame 67 and a 3D football finishes the
  throw; the chest number drifts between 8, 9 and 6 near the release; there is a Nike swoosh and a
  small unreadable chest patch; the helmet reads glossy silver rather than matte gray; the clip is
  480p at 16 fps.
