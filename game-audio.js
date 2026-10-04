/* Prosper Together — sound and music.

   Everything here is synthesised in the browser with the Web Audio API, so
   the game ships no sound files. One idea runs through the music and the
   effects alike: every trade has its own instrument.

     Artist (you)   plucked harp    the melody
     Mystic         glass bells     long chimes on the downbeats
     Farmer         plucked bass    the ground under everything
     Scientist      music box       a clockwork arpeggio
     Craftsperson   marimba         the workshop rhythm
     Healer         bowed viola     a slow, warm countermelody   (Level 2)
     Organizer      frame drum      the pulse that keeps time    (Level 2)

   The music is the society. A player who worked alone last turn plays only
   a few scattered notes of their part, as if from their own house; a player
   who brought energy to the table plays all of it. So the game opens on
   sparse, solitary music, and only a table where everyone contributes plays
   the whole song. A player who dies falls silent for the rest of the run.
   Your own part follows your allocation as you make it. Every change waits
   for the next bar, so voices join and leave in time.

   The same instruments make the effects: a token that lands on the table
   sounds in its owner's instrument, and each seat's sounds come from its
   side of the table. */
window.CommonWorksAudio = (() => {
  'use strict';

  const STORAGE_KEY = 'common-works-table-v11.audio';
  const DEFAULT_PREFS = Object.freeze({ music: .5, effects: .8, muted: false });
  const TEMPO = 76;
  const EIGHTH = 60 / TEMPO / 2;
  const BAR = EIGHTH * 8;
  const LOOKAHEAD = .45;
  const VOICE_ORDER = ['farmer', 'craftsperson', 'organizer', 'healer', 'scientist', 'mystic', 'artist'];
  const LEVEL_ONE_IDS = ['mystic', 'farmer', 'scientist', 'artist', 'craftsperson'];

  /* Seats, left to right as they sit around the table. Music uses a
     narrower image than the effects, so the bass stays near the middle. */
  const PAN = {
    mystic: -.45, craftsperson: -.35, healer: -.25, padL: -.35,
    artist: 0, ui: 0, pulse: 0,
    organizer: .25, scientist: .35, farmer: .45, padR: .35
  };
  const WET = {
    mystic: .5, scientist: .34, artist: .3, healer: .3, craftsperson: .2,
    farmer: .1, organizer: .14, padL: .35, padR: .35, ui: .22, pulse: .05
  };
  const MUSIC_LEVEL = {
    artist: .52, farmer: .38, craftsperson: .3, scientist: .18, mystic: .15,
    healer: .16, organizer: .32, padL: 1, padR: 1, pulse: .8
  };

  const mtof = midi => 440 * 2 ** ((midi - 69) / 12);
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const fit = (midi, [low, high]) => {
    while (midi < low) midi += 12;
    while (midi > high) midi -= 12;
    return midi;
  };
  /* mulberry32: the same seed always gives the same noise, so every render
     of a sound is identical. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------------------------------------------------------- harmony */

  /* Eight bars in D major. `then` is the chord of a bar's second half;
     `fifth` is the bass's second note, the chord's own fifth. Pitch classes
     are listed root, third, fifth, colour. */
  const PROGRESSION = [
    { root: 38, fifth: 45, pcs: [2, 6, 9, 4] },                      // D(add9)
    { root: 47, fifth: 42, pcs: [11, 2, 6, 9] },                     // Bm7
    { root: 43, fifth: 50, pcs: [7, 11, 2, 6] },                     // Gmaj7
    { root: 45, fifth: 40, pcs: [9, 2, 4], then: [9, 1, 4] },        // Asus4 → A
    { root: 43, fifth: 50, pcs: [7, 11, 2, 9] },                     // G(add9)
    { root: 42, fifth: 45, pcs: [2, 6, 9] },                         // D/F# (walks to A)
    { root: 40, fifth: 47, pcs: [4, 7, 11, 2] },                     // Em7
    { root: 45, fifth: 40, pcs: [9, 2, 4, 7], then: [9, 1, 4, 7] }   // A7sus4 → A7
  ];
  const chordAt = (bar, step) => {
    const chord = PROGRESSION[bar];
    return step >= 4 && chord.then ? chord.then : chord.pcs;
  };
  function tones(pcs, low, high) {
    const out = [];
    for (let midi = low; midi <= high; midi += 1) if (pcs.includes(midi % 12)) out.push(midi);
    return out;
  }
  const toneAt = (bar, step, low, high, index) => {
    const found = tones(chordAt(bar, step), low, high);
    return found[clamp(index, 0, found.length - 1)];
  };
  /* A note still ringing when the next bar begins is taken from the tones
     this chord shares with the next one, nearest to `near` (and not `near`
     itself where there is a choice), so it never rubs against what follows. */
  function ringingTone(bar, step, low, high, near) {
    const here = chordAt(bar, step);
    const next = PROGRESSION[(bar + 1) % 8].pcs;
    let found = tones(here.filter(pc => next.includes(pc)), low, high);
    if (!found.length) found = tones(here, low, high);
    const others = found.filter(midi => midi !== near);
    return (others.length ? others : found).reduce((best, midi) => (Math.abs(midi - near) < Math.abs(best - near) ? midi : best));
  }
  /* Two chord tones close together, for the marimba's comping: third and
     fifth, or root and fifth on a suspended chord (whose "third" is the
     suspension). */
  function dyad(bar, step, low = 55) {
    const pcs = chordAt(bar, step);
    const suspended = PROGRESSION[bar].then && step < 4;
    const [a, b] = suspended ? [pcs[0], pcs[2]] : [pcs[1], pcs[2]];
    const lower = tones([a], low, low + 11)[0];
    return [lower, tones([b], lower + 1, lower + 12)[0]];
  }
  /* Chord tones from the bottom up, skipping any a second above the last:
     open voicings that stay clear of the bass. */
  function padVoicing(pcs) {
    const notes = [];
    for (const midi of tones(pcs, 52, 67)) {
      if (!notes.length || midi - notes[notes.length - 1] >= 3) notes.push(midi);
    }
    return notes.slice(0, 4);
  }

  /* The Artist's tune: [midi, eighths], eight to a bar. A is the song,
     B its answer, and every third time round the tune rests. */
  const LEAD_A = [
    [[69, 2], [66, 1], [64, 1], [62, 2], [64, 1], [66, 1]],
    [[66, 3], [69, 1], [71, 2], [69, 2]],
    [[71, 2], [74, 2], [78, 3], [76, 1]],
    [[74, 4], [73, 2], [69, 2]],
    [[71, 2], [69, 1], [67, 1], [71, 2], [74, 2]],
    [[69, 3], [66, 1], [74, 4]],
    [[67, 2], [71, 2], [76, 2], [74, 2]],
    [[76, 3], [74, 1], [73, 2], [69, 2]]
  ];
  const LEAD_B = [
    [[78, 4], [76, 2], [74, 2]],
    [[74, 4], [71, 2], [69, 2]],
    [[71, 6], [69, 1], [67, 1]],
    [[69, 4], [73, 4]],
    [[74, 4], [71, 4]],
    [[69, 4], [66, 2], [69, 2]],
    [[67, 4], [64, 2], [67, 2]],
    [[69, 4], [73, 2], [76, 2]]
  ];
  /* The Healer's line under the tune, a half note at a time. */
  const COUNTER = [[57, 62], [62, 59], [59, 62], [64, 61], [59, 62], [57, 62], [59, 64], [62, 61]];
  /* The Mystic's bells mark each two-bar phrase, on notes that also belong
     to the bar after, so the long ring never rubs against the next chord. */
  const BELLS = { 0: 81, 2: 86, 4: 81, 6: 79 };

  function melody(line, bar, vel) {
    let step = 0;
    return line[bar].map(([midi, dur]) => {
      const event = { step, midi, dur, vel: step === 0 ? vel : vel * .86 };
      step += dur;
      return event;
    });
  }

  /* Each voice has two parts: `full` when it is at the table, `home` when
     it worked alone.

     At the table every instrument has its own register and its own place
     in the bar, so they fit together rather than pile up: the bass and drum
     on the beats (steps 0 and 4), the marimba's chords on the backbeat (2
     and 6), the tune above them, the healer's long notes beneath the tune,
     the music box leading into each new phrase at the end of every second
     bar (5–7), the bells on the first beat of each phrase, and the shaker
     between the beats.

     From home the voices take turns instead: each speaks in its own bar of
     the eight, like neighbours working in separate houses, so the sparse
     music is a slow conversation rather than notes landing together. */
  const PARTS = {
    artist: {
      full(bar, cycle) {
        const phrase = cycle % 3;
        return phrase === 2 ? PARTS.artist.home(bar) : melody(phrase ? LEAD_B : LEAD_A, bar, .9);
      },
      home(bar) {
        return bar === 1 || bar === 5 ? [{ step: 0, midi: LEAD_A[bar][0][0], dur: 4, vel: .42 }] : [];
      }
    },
    farmer: {
      full(bar) {
        const { root, fifth } = PROGRESSION[bar];
        return PROGRESSION[bar].then
          ? [{ step: 0, midi: root, dur: 4, vel: .92 }, { step: 4, midi: root, dur: 2, vel: .68 }, { step: 6, midi: fifth, dur: 2, vel: .58 }]
          : [{ step: 0, midi: root, dur: 4, vel: .92 }, { step: 4, midi: fifth, dur: 4, vel: .7 }];
      },
      home(bar) {
        return bar === 0 || bar === 4 ? [{ step: 0, midi: PROGRESSION[bar].root, dur: 8, vel: .4 }] : [];
      }
    },
    craftsperson: {
      full(bar) {
        const events = [];
        for (const [step, vel] of [[2, .55], [6, .5]]) {
          for (const midi of dyad(bar, step)) events.push({ step, midi, dur: 1, vel });
        }
        if (PROGRESSION[bar].then) events.push({ step: 7, midi: ringingTone(bar, 7, 57, 69, 64), dur: 1, vel: .38 });
        return events;
      },
      home(bar) {
        if (bar !== 2 && bar !== 6) return [];
        const [low, high] = dyad(bar, 2);
        return [{ step: 2, midi: low, dur: 1, vel: .45 }, { step: 5, midi: high, dur: 1, vel: .3 }];
      }
    },
    scientist: {
      full(bar) {
        if (bar % 2 === 0) return [];
        const first = toneAt(bar, 5, 74, 88, 0);
        const second = toneAt(bar, 6, 74, 88, 2);
        return [
          { step: 5, midi: first, dur: 1, vel: .42 },
          { step: 6, midi: second, dur: 1, vel: .48 },
          { step: 7, midi: ringingTone(bar, 7, 74, 88, second), dur: 1, vel: .4 }
        ];
      },
      home(bar) {
        if (bar !== 3 && bar !== 7) return [];
        const first = toneAt(bar, 5, 74, 88, 1);
        return [
          { step: 5, midi: first, dur: 1, vel: .4 },
          { step: 6, midi: ringingTone(bar, 6, 74, 88, first), dur: 2, vel: .3 }
        ];
      }
    },
    mystic: {
      full(bar) {
        return bar in BELLS ? [{ step: 0, midi: BELLS[bar], dur: 8, vel: .58 }] : [];
      },
      home(bar, cycle) {
        if (bar === 4) return [{ step: 3, midi: BELLS[4], dur: 8, vel: .4 }];
        return bar === 0 && cycle % 2 ? [{ step: 4, midi: BELLS[0], dur: 8, vel: .34 }] : [];
      }
    },
    healer: {
      full(bar) {
        const [first, second] = COUNTER[bar];
        return [{ step: 0, midi: first, dur: 4, vel: .56 }, { step: 4, midi: second, dur: 4, vel: .5 }];
      },
      home(bar) {
        return bar === 5 ? [{ step: 4, midi: COUNTER[5][1], dur: 4, vel: .38 }] : [];
      }
    },
    organizer: {
      full(bar) {
        const events = [{ step: 0, kind: 'drum', vel: .85 }, { step: 4, kind: 'drum', vel: .55 }];
        if (PROGRESSION[bar].then) events.push({ step: 6, kind: 'drum', vel: .34 }, { step: 7, kind: 'drum', vel: .3 });
        for (const step of [1, 3, 5, 7]) events.push({ step, kind: 'shaker', vel: step % 4 === 3 ? .5 : .66 });
        return events;
      },
      home(bar) {
        return bar === 6 ? [{ step: 0, kind: 'drum', vel: .32 }] : [];
      }
    }
  };

  /* ------------------------------------------------------------- the engine */

  function roomImpulse(ctx, seconds = 2.3) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      const random = rng(911 + channel * 77);
      let low = 0;
      for (let i = 0; i < length; i += 1) {
        const t = i / rate;
        /* A wooden room: the highs die first, so the tail darkens. */
        low += (.6 - .48 * (t / seconds)) * (random() * 2 - 1 - low);
        const onset = t < .015 ? t / .015 : 1;
        data[i] = low * onset * (1 - t / seconds) ** 3.2;
      }
    }
    return buffer;
  }

  function createEngine(ctx) {
    const E = { ctx, buffers: new Map(), channels: new Map() };
    const master = ctx.createGain();
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20; glue.knee.value = 14; glue.ratio.value = 2.4;
    glue.attack.value = .008; glue.release.value = .22;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = .002; limiter.release.value = .12;
    master.connect(glue); glue.connect(limiter); limiter.connect(ctx.destination);
    const reverb = ctx.createConvolver();
    reverb.buffer = roomImpulse(ctx);
    reverb.connect(master);
    const bus = () => {
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      dry.connect(master); wet.connect(reverb);
      return { dry, wet };
    };
    E.master = master;
    E.buses = { music: bus(), sfx: bus() };

    E.ramp = (param, value, timeConstant = .06) => {
      const now = ctx.currentTime;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.setTargetAtTime(value, now, timeConstant);
    };
    E.setLevel = (name, value, timeConstant) => {
      for (const node of Object.values(E.buses[name])) E.ramp(node.gain, value, timeConstant);
    };
    E.setLevelNow = (name, value) => {
      for (const node of Object.values(E.buses[name])) node.gain.value = value;
    };
    E.fadeIn = (name, value, timeConstant) => {
      const now = ctx.currentTime;
      for (const node of Object.values(E.buses[name])) {
        node.gain.cancelScheduledValues(now);
        node.gain.setValueAtTime(0, now);
        node.gain.setTargetAtTime(value, now, timeConstant);
      }
    };
    E.channel = (name, id) => {
      const key = `${name}:${id}`;
      if (E.channels.has(key)) return E.channels.get(key);
      const input = ctx.createGain();
      const pan = ctx.createStereoPanner();
      const send = ctx.createGain();
      input.gain.value = name === 'music' ? MUSIC_LEVEL[id] ?? 1 : 1;
      pan.pan.value = (PAN[id] || 0) * (name === 'music' ? .6 : 1);
      send.gain.value = WET[id] ?? .2;
      input.connect(pan);
      pan.connect(E.buses[name].dry);
      pan.connect(send); send.connect(E.buses[name].wet);
      E.channels.set(key, input);
      return input;
    };
    return E;
  }

  /* ------------------------------------------------------------ instruments */

  function whiteNoise(E) {
    if (E.buffers.has('noise')) return E.buffers.get('noise');
    const { ctx } = E;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const random = rng(4242);
    for (let i = 0; i < data.length; i += 1) data[i] = random() * 2 - 1;
    E.buffers.set('noise', buffer);
    return buffer;
  }

  /* Filtered noise: breath, paper, cloth, puffs and sweeps. */
  function noise(E, dest, t, dur, { type = 'bandpass', freq = 2000, to = null, q = 1, gain = .2, attack = .005 } = {}) {
    const { ctx } = E;
    const source = ctx.createBufferSource();
    source.buffer = whiteNoise(E);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    if (to) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.setTargetAtTime(0, t + attack, Math.max(.004, (dur - attack) / 4.6));
    source.connect(filter); filter.connect(env); env.connect(dest);
    source.start(t, (t * 7.31) % 1.8);
    source.stop(t + dur + .1);
  }

  /* Sine partials, each with its own decay: bells, music box, marimba, coins.
     spec rows are [ratio, amplitude, share of the decay, detune in cents]. */
  function partials(E, dest, t, freq, spec, vel, decay, attack = .002) {
    const { ctx } = E;
    const total = spec.reduce((sum, row) => sum + row[1], 0);
    const out = ctx.createGain();
    out.gain.value = vel / total;
    out.connect(dest);
    for (const [ratio, amp, share, detune = 0] of spec) {
      const f = freq * ratio;
      if (f > ctx.sampleRate * .45) continue;
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      osc.detune.value = detune;
      const env = ctx.createGain();
      const length = decay * share;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amp, t + attack);
      env.gain.setTargetAtTime(0, t + attack, length / 6.9);
      osc.connect(env); env.connect(out);
      osc.start(t);
      osc.stop(t + attack + length + .05);
    }
  }

  const BELL = [[1, 1, 1], [1, .5, .9, 3], [2, .32, .55], [2.76, .22, .4], [5.4, .08, .2], [8.93, .03, .1]];
  const MUSIC_BOX = [[1, 1, 1], [2, .25, .45], [3, .1, .25], [6.8, .05, .08]];
  const MARIMBA = [[1, 1, 1], [3.93, .3, .28], [9.4, .07, .08]];
  const COIN = [[1, 1, 1], [2.4, .4, .5], [5.9, .15, .2]];

  function bell(E, dest, t, midi, dur, vel) {
    partials(E, dest, t, mtof(midi), BELL, vel, midi > 84 ? 3 : 4.2);
  }
  function musicBox(E, dest, t, midi, dur, vel) {
    partials(E, dest, t, mtof(midi), MUSIC_BOX, vel, clamp(1.9 - (midi - 74) * .04, .7, 1.9), .001);
  }
  function marimba(E, dest, t, midi, dur, vel, muted = false) {
    const decay = muted ? .2 : clamp(.95 - (midi - 55) * .014, .35, .95);
    partials(E, dest, t, mtof(midi), MARIMBA, vel, decay, .0015);
    noise(E, dest, t, .025, { type: 'lowpass', freq: 1500, gain: .12 * vel, attack: .001 });
  }
  function coin(E, dest, t, midi, vel) {
    partials(E, dest, t, mtof(midi), COIN, vel, .55, .001);
  }

  /* Karplus–Strong strings, rendered once per note and kept. The loop runs
     half a sample longer than its whole-sample period, and the playback
     rate trims away what is left of the tuning error. */
  /* `bright` darkens the pluck (lower is rounder); `attack` eases the pick in
     over a few milliseconds, so a string sounds placed rather than struck. */
  const HARP = { name: 'harp', bright: .38, decay: 2.6, length: 2.8, attack: .007 };
  const BASS = { name: 'bass', bright: .12, decay: 3.2, length: 3.2, attack: .014 };

  function stringBuffer(E, midi, preset) {
    const key = `${preset.name}:${midi}`;
    if (E.buffers.has(key)) return E.buffers.get(key);
    const rate = E.ctx.sampleRate;
    const freq = mtof(midi);
    const period = Math.max(2, Math.floor(rate / freq - .5));
    const actual = rate / (period + .5);
    const length = Math.ceil(rate * preset.length);
    const buffer = E.ctx.createBuffer(1, length, rate);
    const y = buffer.getChannelData(0);
    const random = rng(midi * 7919 + preset.name.length);
    const excite = new Float32Array(period);
    let low = 0;
    let mean = 0;
    for (let i = 0; i < period; i += 1) {
      low += preset.bright * (random() * 2 - 1 - low);
      excite[i] = low;
      mean += low;
    }
    mean /= period;
    const loss = .001 ** (1 / (actual * preset.decay));
    let peak = 0;
    for (let n = 0; n < length; n += 1) {
      const a = n >= period ? y[n - period] : 0;
      const b = n > period ? y[n - period - 1] : 0;
      y[n] = (n < period ? excite[n] - mean : 0) + loss * .5 * (a + b);
      peak = Math.max(peak, Math.abs(y[n]));
    }
    if (peak > 0) for (let n = 0; n < length; n += 1) y[n] /= peak;
    const entry = { buffer, rate: freq / actual };
    E.buffers.set(key, entry);
    return entry;
  }

  function pluck(E, dest, t, midi, dur, vel, preset = HARP, glide = 0) {
    const { ctx } = E;
    const { buffer, rate } = stringBuffer(E, midi, preset);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(rate, t);
    if (glide) source.playbackRate.exponentialRampToValueAtTime(rate * 2 ** (glide / 12), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + preset.attack);
    /* A harp string is let ring a touch past its written length: enough to
       join the notes, not so much that it rubs against the next one. */
    const release = t + dur + (preset === BASS ? .05 : .12);
    env.gain.setTargetAtTime(0, release, .12);
    source.connect(env); env.connect(dest);
    source.start(t);
    source.stop(Math.min(t + buffer.duration / rate, release + .9));
  }

  function bass(E, dest, t, midi, dur, vel) {
    pluck(E, dest, t, midi, dur, vel * .8, BASS);
    const { ctx } = E;
    const sub = ctx.createOscillator();
    sub.frequency.value = mtof(midi);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * .22, t + .025);
    env.gain.setTargetAtTime(0, t + .025, .35);
    env.gain.setTargetAtTime(0, t + dur + .05, .06);
    sub.connect(env); env.connect(dest);
    sub.start(t);
    sub.stop(t + dur + .6);
  }

  function bowed(E, dest, t, midi, dur, vel) {
    const { ctx } = E;
    const freq = mtof(midi);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = .7;
    filter.frequency.setValueAtTime(420, t);
    filter.frequency.linearRampToValueAtTime(1500, t + .25);
    filter.frequency.setTargetAtTime(1050, t + .25, .4);
    const env = ctx.createGain();
    const attack = Math.min(.22, dur * .4);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * .5, t + attack);
    env.gain.setValueAtTime(vel * .5, t + dur);
    env.gain.setTargetAtTime(0, t + dur, .09);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.1;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(7, t + .45);
    vibrato.connect(depth);
    for (const detune of [-5, 5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      depth.connect(osc.detune);
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + dur + .8);
    }
    filter.connect(env); env.connect(dest);
    vibrato.start(t);
    vibrato.stop(t + dur + .8);
  }

  function drum(E, dest, t, vel) {
    const { ctx } = E;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(58, t + .14);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + .004);
    env.gain.setTargetAtTime(0, t + .004, .07);
    osc.connect(env); env.connect(dest);
    osc.start(t);
    osc.stop(t + .6);
    noise(E, dest, t, .03, { freq: 1800, q: .9, gain: vel * .22, attack: .001 });
  }

  function shaker(E, dest, t, vel) {
    noise(E, dest, t, .08, { freq: 7600, q: .6, gain: vel * .5, attack: .006 });
  }

  function heartbeat(E, dest, t, vel) {
    const { ctx } = E;
    [[0, 1], [.24, .72]].forEach(([offset, share]) => {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(76, t + offset);
      osc.frequency.exponentialRampToValueAtTime(46, t + offset + .16);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t + offset);
      env.gain.linearRampToValueAtTime(vel * share, t + offset + .012);
      env.gain.setTargetAtTime(0, t + offset + .012, .05);
      osc.connect(env); env.connect(dest);
      osc.start(t + offset);
      osc.stop(t + offset + .4);
      noise(E, dest, t + offset, .07, { type: 'lowpass', freq: 240, gain: vel * share * .5, attack: .004 });
    });
  }

  /* The pad hands each chord to the next the way a string section would:
     a note the next chord keeps goes on ringing into it, and a note the next
     chord drops fades just before it arrives, so no two chords' notes rub. */
  function padChord(E, t, notes, dur, level, cutoff, kept = []) {
    const { ctx } = E;
    const attack = Math.min(.7, dur * .3);
    ['padL', 'padR'].forEach((side, sideIndex) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = .4;
      filter.frequency.value = cutoff;
      filter.connect(E.channel('music', side));
      notes.forEach((midi, index) => {
        if (index % 2 !== sideIndex) return;
        const keeps = kept.includes(midi);
        const end = t + dur - (keeps ? 0 : PAD_HANDOVER);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(level, t + attack);
        env.gain.setValueAtTime(level, end);
        env.gain.setTargetAtTime(0, end, keeps ? .45 : .09);
        env.connect(filter);
        for (const detune of [-7, 7]) {
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.value = mtof(midi);
          osc.detune.value = detune + index;
          osc.connect(env);
          osc.start(t);
          osc.stop(end + (keeps ? 2.4 : .9));
        }
      });
    });
  }
  const PAD_HANDOVER = .22;

  const RANGE = {
    artist: [60, 84], farmer: [38, 52], craftsperson: [55, 79],
    scientist: [74, 93], mystic: [72, 91], healer: [55, 72], organizer: [0, 127]
  };

  /* One note in a player's own instrument. */
  function play(E, dest, id, t, midi, dur, vel, event = {}) {
    const pitch = fit(midi, RANGE[id] || RANGE.artist);
    switch (id) {
      case 'farmer': return bass(E, dest, t, pitch, dur, vel);
      case 'craftsperson': return marimba(E, dest, t, pitch, dur, vel);
      case 'scientist': return musicBox(E, dest, t, pitch, dur, vel);
      case 'mystic': return bell(E, dest, t, pitch, dur, vel);
      case 'healer': return bowed(E, dest, t, pitch, dur, vel);
      case 'organizer': return event.kind === 'shaker' ? shaker(E, dest, t, vel) : drum(E, dest, t, vel);
      default: return pluck(E, dest, t, pitch, dur, vel, HARP);
    }
  }

  /* A player's instrument as an effect, from their seat. The trims even out
     how loud the instruments are for the same velocity. */
  const EFFECT_TRIM = { artist: 1.43, farmer: .75, craftsperson: 1.13, scientist: .6, mystic: .55, healer: .42, organizer: 1.19 };
  function voice(E, id, t, midi, dur, vel) {
    play(E, E.channel('sfx', id), id, t, midi, dur, vel * (EFFECT_TRIM[id] ?? 1));
  }

  /* -------------------------------------------------------------- the music */

  const MOOD_RANK = { calm: 0, watch: 1, urgent: 2 };

  /* The pad's chord for a bar: [offset, pitch classes, length]. A bar that
     resolves mid-way (sus4 to major) holds only the tones both halves share,
     and lets the tune and the marimba make the move; a sustained string
     sliding a semitone under everything else is what sounded harsh. */
  function padSections(bar) {
    const chord = PROGRESSION[bar];
    return [[0, chord.then ? chord.pcs.filter(pc => chord.then.includes(pc)) : chord.pcs, BAR]];
  }

  /* Everything one bar plays, worked out before anything sounds. The music
     plays this list, and arrangement() hands the same list to the harmony
     check, so what is checked is what is heard. */
  function barPlan(scene, count) {
    const bar = count % 8;
    const cycle = Math.floor(count / 8);
    const present = scene.ids.filter(id => scene.voices[id] !== 'off');
    const share = present.length ? present.filter(id => scene.voices[id] === 'full').length / present.length : 0;
    const dark = scene.mood === 'urgent' ? .6 : scene.mood === 'watch' ? .8 : 1;
    const plan = { pads: [], notes: [], pulse: scene.mood === 'urgent' };
    if (scene.pad !== false) {
      const kept = padVoicing(padSections((bar + 1) % 8)[0][1]);
      for (const [offset, pcs, dur] of padSections(bar)) {
        plan.pads.push({ offset, pcs, notes: padVoicing(pcs), kept, dur, level: .03 * (.7 + .3 * share), cutoff: (520 + 700 * share) * dark });
      }
    }
    for (const id of VOICE_ORDER) {
      const mode = scene.voices[id];
      if (!scene.ids.includes(id) || !PARTS[id]?.[mode]) continue;
      const random = rng(count * 131 + VOICE_ORDER.indexOf(id) * 17 + 1);
      for (const event of PARTS[id][mode](bar, cycle)) {
        const swing = event.step % 2 && (id === 'craftsperson' || id === 'organizer') ? EIGHTH * .1 : 0;
        const offset = event.step * EIGHTH + swing + (random() - .5) * .012;
        plan.notes.push({ ...event, id, offset: Math.max(0, offset), seconds: event.dur * EIGHTH, vel: event.vel * (.94 + random() * .12) });
      }
    }
    return plan;
  }

  function createMusic(E) {
    const M = { running: false, bars: 0, nextBar: 0, target: null, playing: null };

    function scheduleBar(time) {
      const count = M.bars;
      M.bars += 1;
      const plan = barPlan(M.playing = structuredClone(M.target), count);
      for (const pad of plan.pads) padChord(E, time + pad.offset, pad.notes, pad.dur, pad.level, pad.cutoff, pad.kept);
      if (plan.pulse) heartbeat(E, E.channel('music', 'pulse'), time, .5);
      for (const note of plan.notes) {
        play(E, E.channel('music', note.id), note.id, time + note.offset, note.midi, note.seconds, note.vel, note);
      }
    }

    M.start = at => {
      M.running = true;
      M.bars = 0;
      M.nextBar = at;
    };
    M.stop = () => { M.running = false; };
    M.pump = () => {
      if (!M.running) return;
      const now = E.ctx.currentTime;
      /* The tab slept or the machine stalled: start the next bar now rather
         than play every missed bar at once. */
      if (M.nextBar < now) M.nextBar = now + .06;
      while (M.nextBar < now + LOOKAHEAD) {
        scheduleBar(M.nextBar);
        M.nextBar += BAR;
      }
    };
    M.renderUntil = seconds => {
      while (M.nextBar < seconds) {
        scheduleBar(M.nextBar);
        M.nextBar += BAR;
      }
    };
    return M;
  }

  /* ------------------------------------------------------------ the effects */

  const PENTATONIC = [62, 64, 66, 69, 71];
  const penta = index => PENTATONIC[((index % 5) + 5) % 5] + 12 * Math.floor(index / 5);
  const D_MAJOR_ARPEGGIO = [62, 66, 69, 74, 78, 81, 86];
  const UNKNOTTED = [62, 65, 68, 71, 74, 77, 80];

  /* Each effect takes the engine, a start time and the event's details. */
  const SFX = {
    /* Your energy */
    /* Placing energy sounds the same wherever it goes: the same wooden
       knock for the table as for autarky. */
    'energy-table'(E, t) {
      SFX['energy-home'](E, t);
    },
    'energy-home'(E, t) {
      const you = E.channel('sfx', 'artist');
      marimba(E, you, t, 62, .2, .8, true);
      marimba(E, you, t + .012, 50, .2, .5, true);
    },
    'energy-middle'(E, t) {
      musicBox(E, E.channel('sfx', 'artist'), t, 81, .2, .22);
    },

    /* Pledges */
    'pledge-on'(E, t, { player = 'mystic' } = {}) {
      const ui = E.channel('sfx', 'ui');
      coin(E, ui, t, 88, .2);
      coin(E, ui, t + .06, 93, .17);
      voice(E, player, t + .13, 74, .5, .24);
    },
    'pledge-off'(E, t) {
      const ui = E.channel('sfx', 'ui');
      coin(E, ui, t, 90, .28);
      coin(E, ui, t + .07, 85, .22);
    },
    refused(E, t, { player = 'ui' } = {}) {
      const dest = E.channel('sfx', player);
      marimba(E, dest, t, 50, .2, .5, true);
      marimba(E, dest, t + .12, 49, .2, .42, true);
    },

    /* The turn */
    resolve(E, t) {
      const ui = E.channel('sfx', 'ui');
      noise(E, ui, t, .28, { freq: 600, to: 1900, q: 1.1, gain: .07, attack: .12 });
      marimba(E, ui, t + .02, 57, .2, .42, true);
      drum(E, ui, t + .02, .28);
    },
    reveal(E, t, { count = 5 } = {}) {
      const ui = E.channel('sfx', 'ui');
      for (let i = 0; i < count; i += 1) {
        noise(E, ui, t + i * .05, .035, { freq: 2600 + i * 140, q: 3, gain: .16 - i * .012, attack: .002 });
      }
      musicBox(E, ui, t + count * .05 + .04, 81, .2, .16);
      musicBox(E, ui, t + count * .05 + .12, 86, .3, .14);
    },
    'turn-start'(E, t) {
      const ui = E.channel('sfx', 'ui');
      marimba(E, ui, t, 74, .2, .4, true);
      marimba(E, ui, t + .13, 69, .2, .3, true);
    },
    settle(E, t) {
      const ui = E.channel('sfx', 'ui');
      noise(E, ui, t, .09, { type: 'lowpass', freq: 420, gain: .14, attack: .004 });
      [50, 57, 66].forEach((midi, i) => bowed(E, ui, t + .02 + i * .03, midi, .45, .12));
    },

    /* Home production */
    'home-make'(E, t, { index = 0 } = {}) {
      const you = E.channel('sfx', 'artist');
      noise(E, you, t, .22, { type: 'lowpass', freq: 1300, to: 280, gain: .2, attack: .01 });
      marimba(E, you, t + .02, [55, 57, 59][index % 3], .2, .5, true);
    },
    shelf(E, t) {
      marimba(E, E.channel('sfx', 'artist'), t, 74, .15, .3, true);
    },

    /* The table */
    'token-land'(E, t, { player = 'artist', index = 0 } = {}) {
      voice(E, player, t, penta(index % 10 + 2), .6, .5);
    },
    'empty-table'(E, t) {
      const ui = E.channel('sfx', 'ui');
      bass(E, ui, t, 38, 1.1, .32);
      bass(E, ui, t + .2, 45, .9, .22);
    },
    waste(E, t) {
      const ui = E.channel('sfx', 'ui');
      pluck(E, E.channel('sfx', 'artist'), t, 69, .75, .5, HARP, -3);
      noise(E, ui, t + .1, .8, { type: 'lowpass', freq: 1800, to: 220, gain: .07, attack: .08 });
    },
    gather(E, t) {
      const ui = E.channel('sfx', 'ui');
      noise(E, ui, t, .65, { freq: 260, to: 2400, q: 1.4, gain: .11, attack: .5 });
      const { ctx } = E;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(mtof(50), t);
      osc.frequency.exponentialRampToValueAtTime(mtof(62), t + .65);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(.06, t + .55);
      env.gain.setTargetAtTime(0, t + .6, .05);
      osc.connect(env); env.connect(ui);
      osc.start(t); osc.stop(t + 1);
    },
    /* The threads meet: a chord if the weave holds, a diminished one that
       never resolves if it frays. */
    weave(E, t, { players = ['artist', 'mystic'], meagre = false } = {}) {
      const ui = E.channel('sfx', 'ui');
      const notes = meagre ? UNKNOTTED : D_MAJOR_ARPEGGIO;
      players.forEach((id, i) => voice(E, id, t + i * .045, notes[i % notes.length], .9, meagre ? .26 : .3));
      noise(E, ui, t, .7, { freq: 1500, to: meagre ? 500 : 4200, q: 1, gain: .04, attack: .3 });
      if (meagre) {
        drum(E, ui, t + .72, .34);
        noise(E, ui, t + .72, .4, { type: 'lowpass', freq: 700, gain: .12, attack: .01 });
      } else {
        bell(E, ui, t + .6, 86, 2, .16);
      }
    },
    goods(E, t, { count = 2, meagre = false } = {}) {
      const ui = E.channel('sfx', 'ui');
      if (meagre) {
        drum(E, ui, t, .24);
        for (let i = 0; i < count; i += 1) marimba(E, ui, t + .12 + i * .07, fit(penta(i), [48, 60]), .2, .34, true);
        return;
      }
      [74, 78, 81].forEach(midi => bell(E, ui, t, midi, 2, .08));
      for (let i = 0; i < count; i += 1) {
        musicBox(E, ui, t + .12 + i * .07, fit(penta(i + 7), [81, 96]), .3, .18);
        noise(E, ui, t + .12 + i * .07, .05, { type: 'highpass', freq: 6000, gain: .04, attack: .002 });
      }
    },
    coin(E, t, { index = 0, kind = 'special' } = {}) {
      const ui = E.channel('sfx', 'ui');
      if (kind === 'autarky') marimba(E, ui, t, fit(penta(index), [62, 76]), .2, .5, true);
      else coin(E, ui, t, penta(index % 10 + 7), .3);
    },

    /* Survival, death and the end */
    warning(E, t, { level = 'watch' } = {}) {
      const ui = E.channel('sfx', 'ui');
      heartbeat(E, ui, t, .55);
      if (level === 'urgent') heartbeat(E, ui, t + .85, .45);
      bell(E, ui, t + .05, 50, 3, .16);
    },
    death(E, t, { player = 'mystic' } = {}) {
      const ui = E.channel('sfx', 'ui');
      bell(E, ui, t, 50, 5, .36);
      [[69, .3, .45], [66, .75, .38], [62, 1.3, .3]].forEach(([midi, at, vel]) => voice(E, player, t + at, midi, .8, vel));
    },
    defeat(E, t) {
      const ui = E.channel('sfx', 'ui');
      const you = E.channel('sfx', 'artist');
      [[69, 0], [65, .42], [64, .84], [62, 1.3]].forEach(([midi, at], i) => pluck(E, you, t + at, midi, i === 3 ? 2 : .4, .5));
      bass(E, ui, t + 1.3, 38, 2.2, .5);
      bell(E, ui, t + 1.3, 50, 4, .28);
      [50, 57, 65].forEach(midi => bowed(E, ui, t + 1.3, midi, 2.4, .16));
    },
    victory(E, t, { players = LEVEL_ONE_IDS } = {}) {
      const ui = E.channel('sfx', 'ui');
      players.forEach((id, i) => voice(E, id, t + i * .11, D_MAJOR_ARPEGGIO[i % 7], .9, .42));
      const chord = t + players.length * .11 + .15;
      [74, 78, 81, 86].forEach(midi => bell(E, ui, chord, midi, 3, .22));
      bass(E, ui, chord, 38, 2.4, .55);
      drum(E, ui, chord, .55);
      [50, 57, 62, 66].forEach(midi => bowed(E, ui, chord, midi, 2.4, .16));
      [93, 90, 88, 86, 83, 81].forEach((midi, i) => musicBox(E, ui, chord + .3 + i * .07, midi, .4, .24));
    },

    /* The interface */
    'dialog-open'(E, t) {
      noise(E, E.channel('sfx', 'ui'), t, .16, { freq: 900, to: 2600, q: 1.2, gain: .24, attack: .05 });
    },
    'dialog-close'(E, t) {
      noise(E, E.channel('sfx', 'ui'), t, .14, { freq: 2600, to: 900, q: 1.2, gain: .2, attack: .02 });
    },
    page(E, t) {
      const ui = E.channel('sfx', 'ui');
      noise(E, ui, t, .09, { freq: 1900, q: .8, gain: .25, attack: .02 });
      noise(E, ui, t + .06, .12, { freq: 1300, q: .8, gain: .18, attack: .01 });
    },
    select(E, t) {
      const you = E.channel('sfx', 'artist');
      pluck(E, you, t, 69, .4, .36);
      pluck(E, you, t + .035, 74, .5, .34);
    },
    start(E, t) {
      const you = E.channel('sfx', 'artist');
      [62, 66, 69, 74].forEach((midi, i) => pluck(E, you, t + i * .07, midi, .6, .32));
      bell(E, E.channel('sfx', 'ui'), t + .3, 81, 2, .18);
    },
    bubble(E, t) {
      const { ctx } = E;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(480, t);
      osc.frequency.exponentialRampToValueAtTime(820, t + .06);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(.24, t + .008);
      env.gain.setTargetAtTime(0, t + .01, .03);
      osc.connect(env); env.connect(E.channel('sfx', 'ui'));
      osc.start(t); osc.stop(t + .25);
    },
    tick(E, t) {
      marimba(E, E.channel('sfx', 'ui'), t, 86, .1, .16, true);
    },
    'sound-on'(E, t) {
      const ui = E.channel('sfx', 'ui');
      musicBox(E, ui, t, 74, .3, .22);
      musicBox(E, ui, t + .09, 81, .4, .2);
    },
    reset(E, t) {
      const ui = E.channel('sfx', 'ui');
      noise(E, ui, t, .3, { freq: 2600, to: 500, q: 1, gain: .06, attack: .03 });
      pluck(E, E.channel('sfx', 'artist'), t + .2, 62, .6, .3);
    }
  };

  /* Cues that arrive together — every token landing at once when motion is
     reduced — are spread out so they are heard one by one. */
  const STAGGER = { 'token-land': .045, coin: .05, 'home-make': .06, shelf: .05, 'energy-home': .05, death: 1.4 };

  /* ----------------------------------------------------------- the service */

  function sanitizePrefs(candidate) {
    const level = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, 1) : fallback);
    return {
      music: level(candidate?.music, DEFAULT_PREFS.music),
      effects: level(candidate?.effects, DEFAULT_PREFS.effects),
      muted: Boolean(candidate?.muted)
    };
  }
  function loadPrefs() {
    try { return sanitizePrefs(JSON.parse(localStorage.getItem(config.storageKey)) || {}); }
    catch { return { ...DEFAULT_PREFS }; }
  }

  const listeners = new Set();
  const stateListeners = new Set();
  const cueLog = [];
  const lastCue = new Map();
  let config = { enabled: true, storageKey: STORAGE_KEY };
  let prefs = loadPrefs();
  let ctx = null;
  let engine = null;
  let music = null;
  let timer = null;
  let unlocked = false;
  let target = null;

  function defaultScene() {
    const ids = (window.CWT_PLAYER_IDS || LEVEL_ONE_IDS).slice();
    return { ids, voices: Object.fromEntries(ids.map(id => [id, 'home'])), mood: 'calm', playing: true };
  }
  target = defaultScene();

  function normalizeScene(candidate = {}, base = defaultScene()) {
    const ids = Array.isArray(candidate.ids) ? candidate.ids.filter(id => PARTS[id]) : base.ids;
    const voices = {};
    for (const id of ids) {
      const mode = candidate.voices?.[id] ?? base.voices?.[id];
      voices[id] = mode === 'full' || mode === 'off' ? mode : 'home';
    }
    return {
      ids,
      voices,
      mood: MOOD_RANK[candidate.mood] !== undefined ? candidate.mood : base.mood,
      playing: candidate.playing === undefined ? base.playing : Boolean(candidate.playing),
      pad: candidate.pad !== false
    };
  }

  function running() {
    return Boolean(engine) && ctx.state === 'running';
  }

  function applyLevels(timeConstant = .06) {
    if (!engine) return;
    engine.ramp(engine.master.gain, prefs.muted ? 0 : 1, timeConstant);
    engine.setLevel('sfx', prefs.effects, timeConstant);
    engine.setLevel('music', music.running ? prefs.music : 0, timeConstant);
  }

  /* Nothing is scheduled while the browser still holds the audio back. */
  function wantMusic() {
    return unlocked && ctx?.state === 'running' && target.playing && !prefs.muted && prefs.music > 0 && !document.hidden;
  }

  function refreshMusic() {
    if (!engine) return;
    if (wantMusic() && !music.running) {
      music.target = target;
      music.start(ctx.currentTime + .08);
      /* Fade in over a couple of seconds rather than start on a downbeat. */
      engine.fadeIn('music', prefs.music, .7);
      music.pump();
    } else if (!wantMusic() && music.running) {
      music.stop();
      engine.setLevel('music', 0, target.playing ? .08 : .5);
    }
  }

  function ensureEngine() {
    if (!config.enabled) return false;
    if (engine) return true;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return false;
    try { ctx = new Context({ latencyHint: 'interactive' }); }
    catch { return false; }
    engine = createEngine(ctx);
    music = createMusic(engine);
    ctx.addEventListener('statechange', () => {
      refreshMusic();
      stateListeners.forEach(listener => listener(ctx.state));
    });
    music.target = target;
    engine.setLevelNow('music', 0);
    applyLevels(.01);
    timer = setInterval(() => music.pump(), 120);
    return true;
  }

  /* Starts the sound. Most browsers let a page make sound only after the
     player has clicked or pressed a key; until then the audio waits,
     suspended, and the first click or key press brings it in. */
  function unlock() {
    if (!ensureEngine()) return;
    unlocked = true;
    if (ctx.state === 'suspended' && !document.hidden) ctx.resume().then(refreshMusic, () => {});
    refreshMusic();
  }

  function cue(name, detail = {}) {
    cueLog.push({ name, detail: { ...detail }, at: Date.now() });
    if (cueLog.length > 500) cueLog.shift();
    if (!SFX[name] || !running() || prefs.muted || prefs.effects <= 0) return false;
    const now = ctx.currentTime + .012;
    const gap = STAGGER[name] || 0;
    const at = gap ? Math.max(now, (lastCue.get(name) ?? 0) + gap) : now;
    if (at > now + 2) return false;
    lastCue.set(name, at);
    SFX[name](engine, at, detail);
    return true;
  }

  function scene(candidate) {
    const next = normalizeScene(candidate, target);
    const rose = MOOD_RANK[next.mood] > MOOD_RANK[target.mood];
    target = next;
    if (music) music.target = target;
    if (rose && candidate?.mood) cue('warning', { level: next.mood });
    refreshMusic();
  }

  function setPrefs(patch) {
    const wasSilent = prefs.muted || prefs.effects <= 0;
    prefs = sanitizePrefs({ ...prefs, ...patch });
    try { localStorage.setItem(config.storageKey, JSON.stringify(prefs)); } catch {}
    if (Object.keys(patch).length) unlock();
    applyLevels();
    refreshMusic();
    if (wasSilent && !prefs.muted && prefs.effects > 0) cue('sound-on');
    listeners.forEach(listener => listener({ ...prefs }));
    return { ...prefs };
  }

  function configure(options = {}) {
    const key = config.storageKey;
    config = { ...config, ...options };
    if (config.storageKey !== key) prefs = loadPrefs();
    if (!config.enabled && engine) {
      clearInterval(timer);
      music.stop();
      ctx.close().catch(() => {});
      ctx = engine = music = null;
      unlocked = false;
    }
  }

  /* Opening and closing windows. The end-of-game windows bring their own
     music, so they make no page sound of their own. */
  function watchDialogs() {
    const quiet = dialog => dialog.classList.contains('mission-win') || dialog.id === 'defeatDialog';
    new MutationObserver(records => {
      for (const record of records) {
        const dialog = record.target;
        if (dialog.tagName !== 'DIALOG' || quiet(dialog)) continue;
        const open = dialog.hasAttribute('open');
        if (open !== (record.oldValue !== null)) cue(open ? 'dialog-open' : 'dialog-close');
      }
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'], attributeOldValue: true });
  }

  function install() {
    for (const type of ['pointerdown', 'keydown', 'touchend']) {
      window.addEventListener(type, () => { if (!running() || !unlocked) unlock(); }, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (!engine) return;
      if (document.hidden) ctx.suspend().catch(() => {});
      else if (unlocked) ctx.resume().then(refreshMusic, () => {});
      refreshMusic();
    });
    watchDialogs();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  /* Renders cues and music without a sound card, for checks and previews. */
  async function renderOffline({ cues = [], scene: musicScene = null, seconds = 4, sampleRate = 44100 } = {}) {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const offline = new Offline(2, Math.ceil(seconds * sampleRate), sampleRate);
    const offlineEngine = createEngine(offline);
    offlineEngine.setLevelNow('music', 1);
    offlineEngine.setLevelNow('sfx', 1);
    for (const item of cues) SFX[item.name](offlineEngine, item.at ?? .02, item.detail || {});
    if (musicScene) {
      const offlineMusic = createMusic(offlineEngine);
      offlineMusic.target = normalizeScene(musicScene);
      offlineMusic.start(.02);
      offlineMusic.bars = musicScene.startBar || 0;
      offlineMusic.renderUntil(seconds);
    }
    return offline.startRendering();
  }

  return {
    configure,
    cue,
    scene,
    unlock,
    setPrefs,
    prefs: () => ({ ...prefs }),
    onPrefs(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /* Called with the audio's new state ('running', 'suspended') whenever the
       browser starts or stops it. */
    onState(listener) { stateListeners.add(listener); return () => stateListeners.delete(listener); },
    state: () => ({
      enabled: config.enabled,
      context: ctx?.state || 'none',
      unlocked,
      music: Boolean(music?.running),
      scene: structuredClone(target)
    }),
    log: () => cueLog.slice(),
    clearLog: () => { cueLog.length = 0; },
    cues: Object.keys(SFX),
    renderOffline,
    /* The notes a scene plays over a number of bars, with the chord under
       each moment: for checking the harmony without listening. */
    arrangement(sceneCandidate, bars = 24) {
      const scene = normalizeScene(sceneCandidate);
      const notes = [];
      for (let count = 0; count < bars; count += 1) {
        const plan = barPlan(scene, count);
        const at = count * BAR;
        for (const pad of plan.pads) {
          for (const midi of pad.notes) {
            const keeps = pad.kept.includes(midi);
            notes.push({ id: 'pad', time: at + pad.offset, midi, seconds: pad.dur - (keeps ? 0 : PAD_HANDOVER), release: keeps ? .45 : .09, vel: pad.level / .03 });
          }
        }
        for (const note of plan.notes) if (note.midi) notes.push({ id: note.id, time: at + note.offset, midi: note.midi, seconds: note.seconds, vel: note.vel });
      }
      const chords = [];
      for (let count = 0; count < bars; count += 1) {
        for (const half of [0, 1]) chords.push({ from: count * BAR + half * BAR / 2, to: count * BAR + (half + 1) * BAR / 2, pcs: chordAt(count % 8, half * 4) });
      }
      return { bar: BAR, levels: { ...MUSIC_LEVEL, pad: 1 }, notes, chords };
    }
  };
})();
