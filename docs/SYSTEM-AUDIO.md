# Real-time system audio — setup and rollback

Fruity EQ is one Spicetify Custom App. Spotify protects its native stream from direct browser audio access, so macOS real-time processing uses a local, windowless bridge. It captures a BlackHole 2ch route, applies the seven configured biquad filters, and writes processed audio to a physical speaker. The status and live meter in Fruity EQ are the source of truth; do not assume that a visible curve is affecting sound.

## Before you start

1. Use Spotify Desktop and make **this computer** the active Spotify Connect device.
2. Keep a physical output device available, such as MacBook speakers, headphones, or Windows speakers.
3. Open **Fruity EQ** in Spotify. Do not start real-time EQ until the virtual device exists.
4. Keep the Spotify Connect output set to **This computer**.

## macOS — BlackHole 2ch

1. Install BlackHole 2ch and FFmpeg:

   ```sh
   brew install blackhole-2ch
   brew install ffmpeg
   ```

2. Make sure the Xcode Command Line Tools are available (`xcode-select --install` if Swift is missing), then install Fruity EQ with `npm run install:local`. The installer starts the local controller with no window.
3. Leave your normal input and output selected. Open Spotify, select **Fruity EQ**, then click **Start real-time EQ**.
4. The bridge temporarily changes only the system output to `BlackHole 2ch`, while its native AudioQueue stays pinned to the physical speaker selected by Fruity EQ.
5. On a first route change, Spotify may keep its previous physical output. If Fruity EQ says **EQ route ready — restart Spotify once**, quit and reopen Spotify; the already-running bridge reconnects automatically. Then press Play.
6. Continue only if Fruity EQ reads `Real-time audio active · BlackHole → EQ → speakers` and shows a changing, non-silent signal level.
7. Move Band 1 or Band 5 by at least ±6 dB. The tonal change is immediate. Toggle **ON/BYPASS** twice to A/B the processed and unprocessed signal.

### macOS rollback

1. In Fruity EQ choose **Stop real-time EQ**. The bridge restores the output and system-output devices that were active when it started.
2. If a previous interrupted bridge left `BlackHole 2ch` selected, in **System Settings → Sound** return Output to your normal physical speakers. Input never needs to change for this bridge.
3. Optionally remove BlackHole with `brew uninstall blackhole-2ch` and restart.

## Windows — browser-capture fallback

1. Install a current virtual cable from the vendor's official site, for example VB-CABLE.
2. In **Settings → System → Sound**, select the cable's playback endpoint as Output and its recording endpoint as Input.
3. In Spotify choose **Fruity EQ → Try browser capture**.
4. Permit access only to the virtual cable in Spotify's microphone dialog.
5. Confirm the status says **System audio active**, then test a ±6 dB band change and global bypass.
6. Restore your normal speakers and microphone before disconnecting the virtual cable.

## Linux — browser-capture fallback

1. Create/select a virtual sink and its monitor source using your distribution's PipeWire/PulseAudio tooling.
2. Set Spotify's output to the virtual sink and choose its monitor source as the input exposed to Spotify/Fruity EQ.
3. Click **Try browser capture**, grant capture access to that monitor source, and test the status and ±6 dB change.
4. Restore your normal source/sink if you disconnect the route.

## Test checklist

1. **Signal path** — on macOS, status becomes `Real-time audio active` and its meter changes while a local Spotify track plays.
2. **Low shelf** — move Band 1 from 0 dB to +6 dB; low end becomes stronger.
3. **Peaking filter** — move Band 5 around 1.6 kHz and change gain ±6 dB; presence changes audibly.
4. **Bypass** — toggle global ON/BYPASS twice; the effect appears/disappears without stopping playback.
5. **Preset** — save, load, and delete a named test preset; the curve and audible response must follow it.
6. **Safety** — choose Stop real-time EQ and verify the normal output device is restored.

If the macOS bridge reports a start error, check that BlackHole 2ch and FFmpeg are installed and that Spotify is playing on This computer. If the optional browser route says `System capture was not permitted` or `cannot select speakers`, the Spotify Chromium build cannot complete that fallback. Fruity EQ leaves the curve visible but does not claim that audio is active.
