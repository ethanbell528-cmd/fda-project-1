# AI-generated intro clip (preview page `intro-preview.html?clip=ai`)

This clip is **AI-generated**. It is not real footage, and the player is not a real person even where he resembles one; the page labels it "AI-generated video, not a real player".

- Model: Wan 2.2 text-to-video A14B (`Wan-AI/Wan2.2-T2V-A14B-Diffusers`), Apache-2.0 license
  (<https://huggingface.co/Wan-AI/Wan2.2-T2V-A14B-Diffusers>). Apache-2.0 places no restriction
  on publishing the output.
- Speed-up LoRA used by the Space: lightx2v `Wan2.1-T2V-14B-StepDistill-CfgDistill`, Apache-2.0.
- Hosted on the public Hugging Face Space `Upsampler/wan-2-2-14b-text-to-video`
  (<https://huggingface.co/spaces/Upsampler/wan-2-2-14b-text-to-video>), run anonymously on 2026-09-25.
- Settings: 832x480, 81 frames at 16 fps (5.06 s), 4 steps, guidance 1, seed 2027.
- Prompt: "Photorealistic slow push-in, night football stadium, stadium floodlights, a quarterback
  in a purple uniform number 8 cocks his arm and releases a spiraling football directly at the
  camera, the ball rushes toward the lens, crowd lights bokeh in background, realistic skin and
  fabric detail, 24fps film look, no logos, no text."
- Changes: re-encoded with FFmpeg as all-intra H.264 and VP9 for scroll scrubbing
  (`qb-ai-720.*` at 832 px, `qb-ai-480.*` at 640 px), audio removed, plus a poster and a still.
- Known issues: the model drew uniform marks it was asked to avoid; the ball is pushed toward the
  lens but is not cleanly released; the clip is 480p at 16 fps.
