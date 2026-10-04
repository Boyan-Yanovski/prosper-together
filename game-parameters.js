/* Prosper Together — the game's parameters, one block per level.

   This file is the one place the game's starting values live. Players of the
   published game (built by publish.py) always play with these values; the
   settings window is hidden there.

   To change them, run the game through serve-game.py (or the UI editor's
   launcher), open the settings window (the gear), set the values and choose
   "Make these the game's values". That rewrites the level's block below and
   keeps the file as it was in editor-backups/. The blocks can also be edited
   here by hand, but they must stay JSON (names in double quotes, no comments
   inside them), since the button rewrites them. Notes belong up here.

   A browser that saved its own settings (Save & restart) keeps them while it
   plays in developer mode; "Use defaults" in the settings window brings back
   the values below.

   In each level's block:
     reserves.startingGoods      goods every player starts with in reserve
     reserves.targetGoods        reserve the automata keep; they consume the rest
     priorAlphas.<automaton>     its starting weights for another player
                                 contributing 0, 1, 2 or 3 energy; only their
                                 proportions matter ([4, 0, 0, 0]: at first it
                                 expects nobody to contribute)
     learningRates.<automaton>   weight of each new observation, from 0 to 1;
                                 older evidence fades at that rate
     survival.minimumWellbeing   wellbeing every player must consume ...
     survival.windowTurns        ... over every run of this many turns; a
                                 minimum of 0 switches the rule off
   Kept for older saves, not used by the game any more:
     startingPersonalTrusts, marketLearning.publicWeight,
     pledgeTrust.shortfallSensitivity

   Why Level 2 was first set apart from Level 1: four players must now reach
   the table to beat autarky, so everyone starts with one more good and
   survival is judged over three turns instead of two (nine over three keeps
   the pace at three a turn). Mira (healer) and Rowan (organizer) have their
   own learning rates; the four original automata keep Level 1's. */
window.CWT_PARAMETERS = {
  "level1": {
    "reserves": { "startingGoods": 1, "targetGoods": 1 },
    "priorAlphas": {
      "mystic": [4, 0, 0, 0],
      "farmer": [8, 0, 0, 0],
      "scientist": [6, 0, 0, 0],
      "craftsperson": [10, 0, 0, 0]
    },
    "learningRates": { "mystic": 0.27, "farmer": 0.17, "scientist": 0.22, "craftsperson": 0.12 },
    "startingPersonalTrusts": { "mystic": 0.5, "farmer": 0.5, "scientist": 0.5, "craftsperson": 0.5 },
    "marketLearning": { "publicWeight": 0.2 },
    "pledgeTrust": { "shortfallSensitivity": 0.8 },
    "survival": { "minimumWellbeing": 6, "windowTurns": 2 }
  },
  "level2": {
    "reserves": { "startingGoods": 2, "targetGoods": 1 },
    "priorAlphas": {
      "mystic": [4, 0, 0, 0],
      "farmer": [8, 0, 0, 0],
      "scientist": [6, 0, 0, 0],
      "craftsperson": [10, 0, 0, 0],
      "healer": [6, 0, 0, 0],
      "organizer": [8, 0, 0, 0]
    },
    "learningRates": {
      "mystic": 0.27,
      "farmer": 0.17,
      "scientist": 0.22,
      "craftsperson": 0.12,
      "healer": 0.27,
      "organizer": 0.22
    },
    "startingPersonalTrusts": {
      "mystic": 0.5,
      "farmer": 0.5,
      "scientist": 0.5,
      "craftsperson": 0.5,
      "healer": 0.5,
      "organizer": 0.5
    },
    "marketLearning": { "publicWeight": 0.2 },
    "pledgeTrust": { "shortfallSensitivity": 0.8 },
    "survival": { "minimumWellbeing": 9, "windowTurns": 3 }
  }
};
