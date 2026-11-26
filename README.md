# Starship: Pixel Flight

Fly Starship yourself, with the arrow keys, in a browser. Everything is real 3D, drawn as crisp pixel art: Gaussian splats with a small palette and dark outlines.

## Play

**Online:** https://benbencfy.github.io/starship-pixel-flight/

Or run it locally:

```bash
npm install
npm run dev
```

Open the address Vite prints. Requires Node 20.19+ (22.12+ on the 22 line) and a browser with WebGL 2.

`npm run build` writes a static site to `dist/` that any web host can serve.

## Missions

- **Return from space**: belly-flop down from 2.4 km, glide in, light the engines, flip upright and lower the ship's catch pins onto the tower's chopstick arms. The arms close by themselves once you hover into the window below them.
- **Pad to pad hop**: lift off from pad A, climb over the high bay, cross 275 m and land on the legs on pad B.
- **Orbital flight**: launch the full stack (Super Heavy and Starship) from the launch mount, go once around the planet, and come home to the tower beside the pad.
  1. Climb dead straight until you clear the tower.
  2. Follow the guide pitch through the gravity turn. The booster drops off by itself when it runs dry.
  3. Burn until apoapsis reaches about 90 km, coast to the top, then burn level until periapsis passes 80 km.
  4. About three quarters of the way round, turn retrograde and burn at minimum throttle until the predicted landing error reads about 0 km.
  5. Reenter with the black heat shield (belly) facing the airflow. Changing the angle of attack stretches or shortens the glide.
  6. Below 2.4 km you're over Starbase for the same belly-flop, flip and catch as the first mission, plus an orbit bonus.

  The planet is scaled down (600 km radius) so an orbit takes about half an hour of game time, and time warp runs automatically on the quiet stretches.

**If you crash into a facility, it breaks too.** The tower, launch mount, chopstick arms, high bay and landing pads shatter around the impact. Whatever stands above the impact point (the tower top, the high bay) topples away from the ship.

**Cadet** gives more fuel, calm air and softer touchdown limits. **Pilot** has tight fuel, gusty wind and real limits, and scores ×1.5. Your best score for each mission is kept in the browser.

## Controls

| Key | |
|---|---|
| ↑ / ↓ | light the engines and throttle up / down (40% minimum; hold ↓ there to cut them) |
| ← / → | pitch the nose left / right; let go and the ship holds its attitude |
| space | time warp while gliding high up, or faster warp in orbit |
| C | camera distance: follow, wide, close (in space: follow, wide, map) |
| T | day or night (also on the menu; remembered) |
| - / = | chunkier / finer pixels |
| P · R · esc | pause · restart · menu |
| 1 · 2 · 3 · D · ⏎ | in the menu: pick a mission, toggle difficulty, launch |

**On a phone or tablet** the game shows on-screen buttons that work like the keys: ← → (pitch) under the left thumb, ↑ ↓ (throttle) under the right, ⏩ WARP while gliding, and pause · camera · day/night · restart · menu in the middle. Hold a button the way you'd hold the key; both thumbs work at once. Landscape gives the widest view. Add `?touch=1` to the address to show the buttons on a desktop.

The flight is planar, so ← and → always turn the ship the way it looks on screen. The side radar (bottom left) shows where you'll end up if nothing changes, and the green beam marks the target. In the orbital flight it becomes an orbit map, and the telemetry shows apoapsis, periapsis, the guide pitch, both stages' fuel, the predicted landing error and the heat shield.

## How it's built

```
src/
  main.js        renderer, effects (plume, plasma, steam, explosions), camera, game loop
  physics.js     flight model, missions, difficulty, collisions, scoring (no three.js)
  orbit.js       the orbital flight: launch, staging, orbit, deorbit, reentry, hand-off
  ui.js          menu, telemetry, side radar, hints, result card
  touch.js       on-screen buttons for phones and tablets
  model.js       Starship, Super Heavy, the tower and arms, pads, high bay, ground, as SDF shapes
  earth.js       the planet from orbit: surface, clouds and atmosphere
  flight.js      the scripted catch that plays behind the menu
  engine/
    sdf.js         signed-distance shapes and the surface sampler
    post.js        the pixel pass: low-res render, palette by vote, outlines
    noise.js       hashes and value noise
    screen.js      full-window canvas, loading text, pixel size
tools/
  tune.mjs       flies the catch and the hop with a keyboard-only autopilot
  tune-orbit.mjs flies the orbital flight up to the hand-off
```

- **Models are built in the browser.** Each part is a set of signed-distance shapes. The sampler turns its surface into flat splats ("surfels") a couple of centimetres apart, and each moving part (ship, four flaps, legs, both arms) sits in its own three.js group.
- **Lighting is live.** A [Spark](https://github.com/sparkjsdev/spark) modifier lights every splat each frame from its normal: moonlight, the tower floodlights, and the engines or a fireball as a moving point light. The plume, plasma, steam, explosions and target beams are splats moved on the GPU.
- **Day and night.** Every colour ramp has a night and a day version, and the shaders pick one with a single value, so switching is instant. The pixel pass swaps the palette and draws the sky as a dithered gradient worked out from each pixel's view direction. It costs nothing and doesn't get in the way of the outlines. `?time=day` forces daytime.
- **Ground and sea.** Wind-rippled dunes with scrub, kept flat along the flight line and under buildings. A wet-sand band with water running up the beach. The sea grades from shallows to deep water, with breakers, a surf line and a glitter path towards the moon or sun.
- **Space.** Above 6 km the view switches to the planet, drawn as splats lit by the sun: oceans with a glint, land, deserts, ice, city lights on the night side and a warm band at sunset, under a cloud shell and an atmosphere glow at the limb. The ship is drawn far larger than the planet's scale, as space games usually do.
- **Shattering.** Each facility has a shader that, after a crash, rotates what stands above the impact down onto the ground and throws the pieces near it outward under gravity.
- **The pixel pass** draws the splats as hard discs at twice the art resolution. Each 2×2 block becomes one pixel, which takes the palette colour most of its samples chose, and silhouette pixels get a darker outline.
- **The physics is planar and pure.** It covers gravity, drag across and along the hull (a belly-flop falls at about 85 m/s and tilting it glides), thrust up to 2 g (hover at about 50%), a 40% minimum throttle, wind gusts and fuel.

### Tuning the difficulty

```bash
npm run tune
```

Flies each mission and difficulty with an autopilot that can only press the arrow keys: perfectly, with 0.25 s reactions, and with a careful final approach. Cadet should succeed comfortably and Pilot only when flown carefully. Mission and difficulty numbers live at the top of `src/physics.js`.

```bash
node tools/tune-orbit.mjs
```

Does the same for the orbital flight, cleanly and sloppily (0.3 s reactions and a wobbly gravity turn), and reports how close to Starbase each run hands over. The numbers are at the top of `src/orbit.js`.

## Credits

- The pixel-art splat renderer (SDF sampler, pixel pass, noise) comes from [pixelart-gaussiansplat](https://github.com/cobanov/pixelart-gaussiansplat) by Mert Cobanov, MIT licensed.
- [Spark](https://github.com/sparkjsdev/spark) by World Labs renders the splats; [three.js](https://threejs.org) does the rest.
- A fan project, not affiliated with SpaceX.

## License

MIT, see [LICENSE](LICENSE).
