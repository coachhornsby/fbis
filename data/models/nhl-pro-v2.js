export const NHL_PRO_V2_ARTIFACT = Object.freeze({
  "modelId": "NHL-PRO-v2",
  "artifactVersion": "research-v2.0-event-chain-gbdt",
  "generatedAt": "2026-10-04T00:40:33.561Z",
  "trained": true,
  "marketInformed": false,
  "source": "NHL_OFFICIAL_API",
  "training": {
    "seasons": [
      "20232024",
      "20242025",
      "20252026"
    ],
    "games": 3936,
    "shots": 341079,
    "fetchErrors": 0
  },
  "featureNames": [
    "distance",
    "angle",
    "rebound",
    "seconds_since_prev",
    "movement",
    "lateral_movement",
    "rush",
    "same_team_prev",
    "special_teams",
    "empty_net",
    "shot_wrist",
    "shot_snap",
    "shot_slap",
    "shot_backhand",
    "shot_tip",
    "shot_other",
    "prev_shot",
    "prev_miss",
    "prev_block",
    "prev_turnover",
    "is_home",
    "distance_sq",
    "angle_sq"
  ],
  "xgModel": {
    "base": -2.53445274798026,
    "trees": [
      {
        "feature": 9,
        "threshold": 0.5,
        "left": -0.004549950941287289,
        "right": 0.15,
        "gain": 685.2864575845381
      },
      {
        "feature": 21,
        "threshold": 0.35,
        "left": 0.0472986639047431,
        "right": -0.039432212239814815,
        "gain": 643.1343598887152
      },
      {
        "feature": 9,
        "threshold": 0.5,
        "left": -0.004310113342701447,
        "right": 0.15,
        "gain": 600.4682915415506
      },
      {
        "feature": 0,
        "threshold": 0.65,
        "left": 0.03854092210070797,
        "right": -0.04160238621651239,
        "gain": 551.0019560682118
      },
      {
        "feature": 9,
        "threshold": 0.5,
        "left": -0.004091574517755932,
        "right": 0.15,
        "gain": 523.4745400595001
      },
      {
        "feature": 21,
        "threshold": 0.35,
        "left": 0.03849498253264897,
        "right": -0.036160339974476215,
        "gain": 478.3017730547101
      },
      {
        "feature": 9,
        "threshold": 0.5,
        "left": -0.00388864155092882,
        "right": 0.15,
        "gain": 453.19856685306195
      },
      {
        "feature": 0,
        "threshold": 0.65,
        "left": 0.031809381579947185,
        "right": -0.0383731402628622,
        "gain": 417.2477983281708
      },
      {
        "feature": 9,
        "threshold": 0.5,
        "left": -0.003702592056780786,
        "right": 0.15,
        "gain": 390.23484680084556
      },
      {
        "feature": 0,
        "threshold": 0.65,
        "left": 0.028868362043883475,
        "right": -0.03674503712345955,
        "gain": 361.6103159718434
      },
      {
        "feature": 9,
        "threshold": 0.5,
        "left": -0.003528658714637048,
        "right": 0.15,
        "gain": 333.77626649722947
      },
      {
        "feature": 21,
        "threshold": 0.35,
        "left": 0.02905712909599572,
        "right": -0.03169326446019722,
        "gain": 314.37445371285014
      },
      {
        "feature": 21,
        "threshold": 0.65,
        "left": 0.019043214499275023,
        "right": -0.04464184529624835,
        "gain": 286.22371726775356
      },
      {
        "feature": 9,
        "threshold": 0.5,
        "left": -0.0034491866494971582,
        "right": 0.15,
        "gain": 288.6060141096751
      },
      {
        "feature": 21,
        "threshold": 0.65,
        "left": 0.017493965932884766,
        "right": -0.04310794836028523,
        "gain": 253.11558011959184
      },
      {
        "feature": 9,
        "threshold": 0.5,
        "left": -0.003285434055532865,
        "right": 0.15,
        "gain": 244.03992148123447
      },
      {
        "feature": 21,
        "threshold": 0.65,
        "left": 0.016078007658029376,
        "right": -0.04161604989997004,
        "gain": 224.10232545478596
      },
      {
        "feature": 9,
        "threshold": 0.5,
        "left": -0.003129726483236749,
        "right": 0.15,
        "gain": 204.59512033154232
      },
      {
        "feature": 21,
        "threshold": 0.35,
        "left": 0.021746850763781037,
        "right": -0.027424537612656716,
        "gain": 202.53293081371345
      },
      {
        "feature": 21,
        "threshold": 0.65,
        "left": 0.013884371275475812,
        "right": -0.03909113892855375,
        "gain": 181.74023970618978
      },
      {
        "feature": 9,
        "threshold": 0.5,
        "left": -0.0030438665167232776,
        "right": 0.15,
        "gain": 172.7278956108712
      },
      {
        "feature": 0,
        "threshold": 0.45,
        "left": 0.024825411775399438,
        "right": -0.01908176041606715,
        "gain": 161.9993309722044
      },
      {
        "feature": 8,
        "threshold": 0.5,
        "left": -0.011950221602654486,
        "right": 0.03853305198542659,
        "gain": 159.42187204439466
      },
      {
        "feature": 21,
        "threshold": 0.65,
        "left": 0.012104506378758007,
        "right": -0.03685025095469712,
        "gain": 149.77541635965989
      },
      {
        "feature": 9,
        "threshold": 0.5,
        "left": -0.00290480025043706,
        "right": 0.12800486129404798,
        "gain": 135.8654334650539
      },
      {
        "feature": 21,
        "threshold": 0.65,
        "left": 0.011177213522905804,
        "right": -0.035501372132244746,
        "gain": 133.2081406138091
      },
      {
        "feature": 8,
        "threshold": 0.5,
        "left": -0.010958566571591959,
        "right": 0.03321956362831002,
        "gain": 125.17113166041298
      },
      {
        "feature": 21,
        "threshold": 0.18,
        "left": 0.021517013149800635,
        "right": -0.016160944164731898,
        "gain": 118.52198845787983
      },
      {
        "feature": 9,
        "threshold": 0.5,
        "left": -0.0027499445576484277,
        "right": 0.11142503389332738,
        "gain": 109.25815731519509
      },
      {
        "feature": 21,
        "threshold": 0.65,
        "left": 0.009845336914657261,
        "right": -0.033387381293771994,
        "gain": 110.47857855227811
      },
      {
        "feature": 22,
        "threshold": 0.4,
        "left": 0.008262148923704528,
        "right": -0.03639847496312586,
        "gain": 100.96118879195899
      },
      {
        "feature": 0,
        "threshold": 0.65,
        "left": 0.01245166833048433,
        "right": -0.023998491355191828,
        "gain": 101.09242151026608
      },
      {
        "feature": 8,
        "threshold": 0.5,
        "left": -0.01004046654099988,
        "right": 0.02872451333022067,
        "gain": 98.34861064016032
      },
      {
        "feature": 22,
        "threshold": 0.4,
        "left": 0.007672936744775377,
        "right": -0.03506343853781681,
        "gain": 90.6726686220826
      }
    ],
    "featureNames": [
      "distance",
      "angle",
      "rebound",
      "seconds_since_prev",
      "movement",
      "lateral_movement",
      "rush",
      "same_team_prev",
      "special_teams",
      "empty_net",
      "shot_wrist",
      "shot_snap",
      "shot_slap",
      "shot_backhand",
      "shot_tip",
      "shot_other",
      "prev_shot",
      "prev_miss",
      "prev_block",
      "prev_turnover",
      "is_home",
      "distance_sq",
      "angle_sq"
    ]
  },
  "league": {
    "goals": 3.093369,
    "xg": 3.216172,
    "specialTeamsXg": 0.914335,
    "shots": 43.328125,
    "highDanger": 12.349339,
    "rush": 4.366743
  },
  "teams": {
    "TBL": {
      "games": 246,
      "gfpg": 3.55691,
      "gapg": 2.9187,
      "xgf": 3.45855,
      "xga": 3.05253,
      "stxgf": 1.05241,
      "stxga": 0.87589,
      "shotsFor": 43.34959,
      "shotsAgainst": 41.19919,
      "highDangerFor": 13.26423,
      "highDangerAgainst": 11.53252,
      "rushFor": 4.13821,
      "rushAgainst": 4.39024,
      "elo": 1595.171
    },
    "NSH": {
      "games": 246,
      "gfpg": 2.96748,
      "gapg": 3.21545,
      "xgf": 3.23966,
      "xga": 3.23769,
      "stxgf": 0.95153,
      "stxga": 0.90855,
      "shotsFor": 44.23984,
      "shotsAgainst": 42.95935,
      "highDangerFor": 12.42683,
      "highDangerAgainst": 12.23984,
      "rushFor": 4.21138,
      "rushAgainst": 4.47561,
      "elo": 1472.746
    },
    "PIT": {
      "games": 246,
      "gfpg": 3.21545,
      "gapg": 3.30081,
      "xgf": 3.43581,
      "xga": 3.33128,
      "stxgf": 0.96152,
      "stxga": 0.93108,
      "shotsFor": 45.08943,
      "shotsAgainst": 44.68699,
      "highDangerFor": 13.60569,
      "highDangerAgainst": 12.77236,
      "rushFor": 4.54878,
      "rushAgainst": 4.70325,
      "elo": 1526.054
    },
    "CHI": {
      "games": 246,
      "gfpg": 2.5122,
      "gapg": 3.5,
      "xgf": 2.68336,
      "xga": 3.50365,
      "stxgf": 0.7089,
      "stxga": 0.88141,
      "shotsFor": 37.27642,
      "shotsAgainst": 46.34959,
      "highDangerFor": 10.22358,
      "highDangerAgainst": 14.17073,
      "rushFor": 3.78455,
      "rushAgainst": 4.45935,
      "elo": 1352.73
    },
    "VGK": {
      "games": 246,
      "gfpg": 3.28049,
      "gapg": 2.90244,
      "xgf": 3.39013,
      "xga": 3.02422,
      "stxgf": 0.88969,
      "stxga": 0.77253,
      "shotsFor": 44.10569,
      "shotsAgainst": 41.76016,
      "highDangerFor": 13.39837,
      "highDangerAgainst": 11.30894,
      "rushFor": 4.52846,
      "rushAgainst": 4.26423,
      "elo": 1522.804
    },
    "SEA": {
      "games": 246,
      "gfpg": 2.80488,
      "gapg": 3.10569,
      "xgf": 2.961,
      "xga": 3.31689,
      "stxgf": 0.80872,
      "stxga": 0.89749,
      "shotsFor": 41.80894,
      "shotsAgainst": 45.15854,
      "highDangerFor": 11.06504,
      "highDangerAgainst": 11.9878,
      "rushFor": 4.4878,
      "rushAgainst": 4.76423,
      "elo": 1401.336
    },
    "CAR": {
      "games": 246,
      "gfpg": 3.4187,
      "gapg": 2.80081,
      "xgf": 3.62455,
      "xga": 2.82913,
      "stxgf": 0.9955,
      "stxga": 0.79401,
      "shotsFor": 50.91463,
      "shotsAgainst": 36.78862,
      "highDangerFor": 13.80894,
      "highDangerAgainst": 11.93496,
      "rushFor": 5.65041,
      "rushAgainst": 3.46748,
      "elo": 1614.637
    },
    "OTT": {
      "games": 246,
      "gfpg": 3.15447,
      "gapg": 3.0935,
      "xgf": 3.24759,
      "xga": 2.98477,
      "stxgf": 0.99204,
      "stxga": 0.85073,
      "shotsFor": 44.52846,
      "shotsAgainst": 40.54878,
      "highDangerFor": 12.27236,
      "highDangerAgainst": 11.05691,
      "rushFor": 4.8374,
      "rushAgainst": 3.88618,
      "elo": 1583.817
    },
    "TOR": {
      "games": 246,
      "gfpg": 3.34959,
      "gapg": 3.22358,
      "xgf": 3.41931,
      "xga": 3.41215,
      "stxgf": 1.00662,
      "stxga": 1.01229,
      "shotsFor": 42.88618,
      "shotsAgainst": 46.34553,
      "highDangerFor": 12.96748,
      "highDangerAgainst": 12.86992,
      "rushFor": 4.4187,
      "rushAgainst": 4.80488,
      "elo": 1401.699
    },
    "MTL": {
      "games": 246,
      "gfpg": 3.10569,
      "gapg": 3.29268,
      "xgf": 3.14971,
      "xga": 3.41985,
      "stxgf": 0.93025,
      "stxga": 1.0615,
      "shotsFor": 40.71951,
      "shotsAgainst": 45.47967,
      "highDangerFor": 11.77236,
      "highDangerAgainst": 13.53252,
      "rushFor": 3.78862,
      "rushAgainst": 4.35772,
      "elo": 1580.153
    },
    "BOS": {
      "games": 246,
      "gfpg": 3.0935,
      "gapg": 3.03252,
      "xgf": 3.14732,
      "xga": 3.30864,
      "stxgf": 0.94341,
      "stxga": 0.98657,
      "shotsFor": 41.47561,
      "shotsAgainst": 44.72358,
      "highDangerFor": 11.9187,
      "highDangerAgainst": 12.89024,
      "rushFor": 4.2439,
      "rushAgainst": 4.71138,
      "elo": 1536.13
    },
    "CGY": {
      "games": 246,
      "gfpg": 2.80488,
      "gapg": 3.12195,
      "xgf": 3.02841,
      "xga": 3.30929,
      "stxgf": 0.83616,
      "stxga": 0.97319,
      "shotsFor": 44.21951,
      "shotsAgainst": 43.83333,
      "highDangerFor": 11.69512,
      "highDangerAgainst": 13.2561,
      "rushFor": 4.95935,
      "rushAgainst": 4.56911,
      "elo": 1433.366
    },
    "WPG": {
      "games": 246,
      "gfpg": 3.11789,
      "gapg": 2.64228,
      "xgf": 3.16705,
      "xga": 3.11788,
      "stxgf": 0.83701,
      "stxga": 0.82897,
      "shotsFor": 42.71951,
      "shotsAgainst": 42.70732,
      "highDangerFor": 12.57317,
      "highDangerAgainst": 11.96341,
      "rushFor": 4.1626,
      "rushAgainst": 4.36992,
      "elo": 1452.249
    },
    "LAK": {
      "games": 246,
      "gfpg": 2.97154,
      "gapg": 2.71545,
      "xgf": 3.23954,
      "xga": 3.00785,
      "stxgf": 0.88462,
      "stxga": 0.89876,
      "shotsFor": 45.33333,
      "shotsAgainst": 40.80894,
      "highDangerFor": 12.24797,
      "highDangerAgainst": 11.34959,
      "rushFor": 4.41057,
      "rushAgainst": 4.03252,
      "elo": 1462.918
    },
    "COL": {
      "games": 246,
      "gfpg": 3.58943,
      "gapg": 2.80894,
      "xgf": 3.59574,
      "xga": 3.05777,
      "stxgf": 1.04054,
      "stxga": 0.89328,
      "shotsFor": 47.68293,
      "shotsAgainst": 40.95122,
      "highDangerFor": 14.02033,
      "highDangerAgainst": 11.44715,
      "rushFor": 4.92276,
      "rushAgainst": 4.2439,
      "elo": 1626.441
    },
    "VAN": {
      "games": 246,
      "gfpg": 2.97154,
      "gapg": 3.21951,
      "xgf": 3.01964,
      "xga": 3.2298,
      "stxgf": 0.89302,
      "stxga": 0.92852,
      "shotsFor": 41.24797,
      "shotsAgainst": 42.93496,
      "highDangerFor": 12.00407,
      "highDangerAgainst": 12.57724,
      "rushFor": 4.00813,
      "rushAgainst": 4.09756,
      "elo": 1321.554
    },
    "EDM": {
      "games": 246,
      "gfpg": 3.39431,
      "gapg": 3.01626,
      "xgf": 3.51498,
      "xga": 3.03515,
      "stxgf": 0.9446,
      "stxga": 0.81029,
      "shotsFor": 46.06504,
      "shotsAgainst": 40.43496,
      "highDangerFor": 13.89024,
      "highDangerAgainst": 11.76829,
      "rushFor": 4.39837,
      "rushAgainst": 3.78049,
      "elo": 1520.226
    },
    "BUF": {
      "games": 246,
      "gfpg": 3.26423,
      "gapg": 3.14634,
      "xgf": 3.2964,
      "xga": 3.29204,
      "stxgf": 0.93373,
      "stxga": 0.97084,
      "shotsFor": 43.45122,
      "shotsAgainst": 44.04065,
      "highDangerFor": 11.63008,
      "highDangerAgainst": 12.7561,
      "rushFor": 4.06098,
      "rushAgainst": 4.77642,
      "elo": 1610.568
    },
    "NYR": {
      "games": 246,
      "gfpg": 3.15447,
      "gapg": 2.98374,
      "xgf": 3.23978,
      "xga": 3.27026,
      "stxgf": 0.95864,
      "stxga": 0.90585,
      "shotsFor": 43.61789,
      "shotsAgainst": 44.02439,
      "highDangerFor": 12.21138,
      "highDangerAgainst": 12.19106,
      "rushFor": 4.60976,
      "rushAgainst": 4.32927,
      "elo": 1476.303
    },
    "CBJ": {
      "games": 246,
      "gfpg": 3.10163,
      "gapg": 3.3374,
      "xgf": 3.19768,
      "xga": 3.39982,
      "stxgf": 0.81113,
      "stxga": 0.93609,
      "shotsFor": 43.65447,
      "shotsAgainst": 46.33333,
      "highDangerFor": 11.65447,
      "highDangerAgainst": 13.10569,
      "rushFor": 4.62602,
      "rushAgainst": 4.97154,
      "elo": 1518.673
    },
    "PHI": {
      "games": 246,
      "gfpg": 2.93902,
      "gapg": 3.21138,
      "xgf": 3.11257,
      "xga": 3.02344,
      "stxgf": 0.87565,
      "stxga": 0.88626,
      "shotsFor": 42.5,
      "shotsAgainst": 40.85772,
      "highDangerFor": 12.22358,
      "highDangerAgainst": 11.30488,
      "rushFor": 4.15041,
      "rushAgainst": 4.17886,
      "elo": 1533.414
    },
    "NJD": {
      "games": 246,
      "gfpg": 2.99187,
      "gapg": 3.08537,
      "xgf": 3.16887,
      "xga": 3.12597,
      "stxgf": 0.88695,
      "stxga": 0.84864,
      "shotsFor": 43.91463,
      "shotsAgainst": 42.13415,
      "highDangerFor": 12.56504,
      "highDangerAgainst": 12.09756,
      "rushFor": 4.60976,
      "rushAgainst": 4.37398,
      "elo": 1480.973
    },
    "DET": {
      "games": 246,
      "gfpg": 3.07724,
      "gapg": 3.21545,
      "xgf": 3.16864,
      "xga": 3.29189,
      "stxgf": 0.96875,
      "stxga": 0.89013,
      "shotsFor": 42.30081,
      "shotsAgainst": 44.69512,
      "highDangerFor": 11.31707,
      "highDangerAgainst": 12.53252,
      "rushFor": 4.00407,
      "rushAgainst": 4.34146,
      "elo": 1465.48
    },
    "DAL": {
      "games": 246,
      "gfpg": 3.47154,
      "gapg": 2.78049,
      "xgf": 3.43807,
      "xga": 3.04681,
      "stxgf": 1.02738,
      "stxga": 0.8554,
      "shotsFor": 42.30081,
      "shotsAgainst": 42.02439,
      "highDangerFor": 13.60163,
      "highDangerAgainst": 11.56504,
      "rushFor": 4.08943,
      "rushAgainst": 4.46341,
      "elo": 1590.437
    },
    "STL": {
      "games": 246,
      "gfpg": 2.94309,
      "gapg": 3.0122,
      "xgf": 2.98477,
      "xga": 3.21179,
      "stxgf": 0.82411,
      "stxga": 0.86037,
      "shotsFor": 39.46748,
      "shotsAgainst": 43.44715,
      "highDangerFor": 11.17886,
      "highDangerAgainst": 12.47967,
      "rushFor": 3.78049,
      "rushAgainst": 4.53659,
      "elo": 1528.751
    },
    "MIN": {
      "games": 246,
      "gfpg": 3.05285,
      "gapg": 3.01626,
      "xgf": 3.23618,
      "xga": 3.17628,
      "stxgf": 0.9747,
      "stxga": 0.90708,
      "shotsFor": 43.52033,
      "shotsAgainst": 44.35366,
      "highDangerFor": 12.3374,
      "highDangerAgainst": 11.5122,
      "rushFor": 4.20732,
      "rushAgainst": 4.10976,
      "elo": 1550.745
    },
    "FLA": {
      "games": 246,
      "gfpg": 3.13415,
      "gapg": 2.84146,
      "xgf": 3.30025,
      "xga": 3.00718,
      "stxgf": 1.05981,
      "stxga": 0.91397,
      "shotsFor": 47.11382,
      "shotsAgainst": 40.4878,
      "highDangerFor": 13.01626,
      "highDangerAgainst": 11.34146,
      "rushFor": 5.04065,
      "rushAgainst": 4.36992,
      "elo": 1479.743
    },
    "SJS": {
      "games": 246,
      "gfpg": 2.60976,
      "gapg": 3.81301,
      "xgf": 2.80217,
      "xga": 3.5914,
      "stxgf": 0.77338,
      "stxga": 1.04074,
      "shotsFor": 38.84553,
      "shotsAgainst": 47.95122,
      "highDangerFor": 10.80894,
      "highDangerAgainst": 14.31301,
      "rushFor": 3.92683,
      "rushAgainst": 4.64634,
      "elo": 1407.76
    },
    "ARI": {
      "games": 82,
      "gfpg": 3.12195,
      "gapg": 3.34146,
      "xgf": 3.0987,
      "xga": 3.45048,
      "stxgf": 0.84637,
      "stxga": 1.03612,
      "shotsFor": 41.14634,
      "shotsAgainst": 46.23171,
      "highDangerFor": 11.68293,
      "highDangerAgainst": 12.60976,
      "rushFor": 4.41463,
      "rushAgainst": 5.08537,
      "elo": 1470.174
    },
    "WSH": {
      "games": 246,
      "gfpg": 3.13415,
      "gapg": 2.97967,
      "xgf": 3.18579,
      "xga": 3.22279,
      "stxgf": 0.9214,
      "stxga": 0.93365,
      "shotsFor": 42.2561,
      "shotsAgainst": 44,
      "highDangerFor": 12.81301,
      "highDangerAgainst": 12.49187,
      "rushFor": 4.0935,
      "rushAgainst": 4.33333,
      "elo": 1544.477
    },
    "NYI": {
      "games": 246,
      "gfpg": 2.85772,
      "gapg": 3.10569,
      "xgf": 3.12803,
      "xga": 3.37868,
      "stxgf": 0.84675,
      "stxga": 0.96615,
      "shotsFor": 43.81301,
      "shotsAgainst": 44.95528,
      "highDangerFor": 12.53659,
      "highDangerAgainst": 12.90244,
      "rushFor": 4.62602,
      "rushAgainst": 4.30894,
      "elo": 1459.823
    },
    "ANA": {
      "games": 246,
      "gfpg": 2.8374,
      "gapg": 3.43902,
      "xgf": 3.10455,
      "xga": 3.52171,
      "stxgf": 0.88324,
      "stxga": 1.07881,
      "shotsFor": 43.10569,
      "shotsAgainst": 46.92683,
      "highDangerFor": 11.84553,
      "highDangerAgainst": 13.9187,
      "rushFor": 4.17073,
      "rushAgainst": 4.21138,
      "elo": 1450.977
    },
    "UTA": {
      "games": 164,
      "gfpg": 3.10366,
      "gapg": 2.9939,
      "xgf": 3.29772,
      "xga": 3.04309,
      "stxgf": 0.83163,
      "stxga": 0.92143,
      "shotsFor": 43.89024,
      "shotsAgainst": 40.78049,
      "highDangerFor": 12.58537,
      "highDangerAgainst": 11.70732,
      "rushFor": 4.15244,
      "rushAgainst": 4.06707,
      "elo": 1527.67
    }
  },
  "shooters": {
    "8470600": {
      "shots": 259,
      "goals": 4,
      "xg": 13.134,
      "factor": 0.82,
      "team": "DAL"
    },
    "8470604": {
      "shots": 135,
      "goals": 11,
      "xg": 10.72,
      "factor": 1.00642,
      "team": "PIT"
    },
    "8470610": {
      "shots": 62,
      "goals": 5,
      "xg": 5.096,
      "factor": 0.99812,
      "team": "COL"
    },
    "8470613": {
      "shots": 843,
      "goals": 28,
      "xg": 40.301,
      "factor": 0.82,
      "team": "CAR"
    },
    "8470621": {
      "shots": 449,
      "goals": 48,
      "xg": 39.636,
      "factor": 1.12534,
      "team": "EDM"
    },
    "8470794": {
      "shots": 264,
      "goals": 27,
      "xg": 23.872,
      "factor": 1.05836,
      "team": "DAL"
    },
    "8470966": {
      "shots": 83,
      "goals": 3,
      "xg": 4.5,
      "factor": 0.96212,
      "team": "TOR"
    },
    "8471214": {
      "shots": 1151,
      "goals": 107,
      "xg": 83.745,
      "factor": 1.2,
      "team": "WSH"
    },
    "8471215": {
      "shots": 660,
      "goals": 64,
      "xg": 54.188,
      "factor": 1.12397,
      "team": "PIT"
    },
    "8471218": {
      "shots": 116,
      "goals": 9,
      "xg": 8.835,
      "factor": 1.00385,
      "team": "NYR"
    },
    "8471274": {
      "shots": 51,
      "goals": 0,
      "xg": 2.916,
      "factor": 0.94102,
      "team": "MIN"
    },
    "8471675": {
      "shots": 990,
      "goals": 110,
      "xg": 86.959,
      "factor": 1.2,
      "team": "PIT"
    },
    "8471677": {
      "shots": 148,
      "goals": 3,
      "xg": 7.405,
      "factor": 0.87099,
      "team": "COL"
    },
    "8471685": {
      "shots": 495,
      "goals": 59,
      "xg": 42.431,
      "factor": 1.2,
      "team": "LAK"
    },
    "8471686": {
      "shots": 37,
      "goals": 1,
      "xg": 1.916,
      "factor": 0.98425,
      "team": "PHI"
    },
    "8471698": {
      "shots": 162,
      "goals": 13,
      "xg": 14.906,
      "factor": 0.96059,
      "team": "WSH"
    },
    "8471699": {
      "shots": 80,
      "goals": 6,
      "xg": 5.366,
      "factor": 1.01459,
      "team": "COL"
    },
    "8471709": {
      "shots": 140,
      "goals": 7,
      "xg": 7.086,
      "factor": 0.9975,
      "team": "SJS"
    },
    "8471724": {
      "shots": 642,
      "goals": 23,
      "xg": 36.142,
      "factor": 0.82,
      "team": "PIT"
    },
    "8471817": {
      "shots": 111,
      "goals": 7,
      "xg": 8.876,
      "factor": 0.95759,
      "team": "TOR"
    },
    "8473419": {
      "shots": 796,
      "goals": 82,
      "xg": 66.624,
      "factor": 1.16804,
      "team": "BOS"
    },
    "8473422": {
      "shots": 390,
      "goals": 37,
      "xg": 33.132,
      "factor": 1.06434,
      "team": "CHI"
    },
    "8473446": {
      "shots": 133,
      "goals": 7,
      "xg": 7.189,
      "factor": 0.99473,
      "team": "BUF"
    },
    "8473449": {
      "shots": 154,
      "goals": 12,
      "xg": 12.143,
      "factor": 0.99674,
      "team": "BUF"
    },
    "8473453": {
      "shots": 270,
      "goals": 15,
      "xg": 18.793,
      "factor": 0.91507,
      "team": "LAK"
    },
    "8473473": {
      "shots": 2,
      "goals": 0,
      "xg": 0.097,
      "factor": 0.99987,
      "team": "BOS"
    },
    "8473504": {
      "shots": 89,
      "goals": 7,
      "xg": 7.22,
      "factor": 0.99522,
      "team": "NYI"
    },
    "8473507": {
      "shots": 276,
      "goals": 4,
      "xg": 14.065,
      "factor": 0.82,
      "team": "DET"
    },
    "8473512": {
      "shots": 637,
      "goals": 51,
      "xg": 48.272,
      "factor": 1.03781,
      "team": "OTT"
    },
    "8473533": {
      "shots": 517,
      "goals": 43,
      "xg": 44.667,
      "factor": 0.97652,
      "team": "CAR"
    },
    "8473563": {
      "shots": 17,
      "goals": 0,
      "xg": 1.595,
      "factor": 0.98566,
      "team": "WSH"
    },
    "8473604": {
      "shots": 151,
      "goals": 11,
      "xg": 12.912,
      "factor": 0.9583,
      "team": "WPG"
    },
    "8473986": {
      "shots": 624,
      "goals": 53,
      "xg": 50.794,
      "factor": 1.02912,
      "team": "ANA"
    },
    "8473994": {
      "shots": 523,
      "goals": 53,
      "xg": 45.486,
      "factor": 1.10451,
      "team": "DAL"
    },
    "8474009": {
      "shots": 48,
      "goals": 1,
      "xg": 3.831,
      "factor": 0.94963,
      "team": "NYR"
    },
    "8474013": {
      "shots": 329,
      "goals": 6,
      "xg": 16.912,
      "factor": 0.82,
      "team": "UTA"
    },
    "8474031": {
      "shots": 105,
      "goals": 7,
      "xg": 5.691,
      "factor": 1.03522,
      "team": "BOS"
    },
    "8474034": {
      "shots": 186,
      "goals": 9,
      "xg": 14.882,
      "factor": 0.86936,
      "team": "CHI"
    },
    "8474037": {
      "shots": 481,
      "goals": 43,
      "xg": 43.135,
      "factor": 0.99808,
      "team": "BOS"
    },
    "8474040": {
      "shots": 60,
      "goals": 5,
      "xg": 4.843,
      "factor": 1.00306,
      "team": "EDM"
    },
    "8474053": {
      "shots": 15,
      "goals": 1,
      "xg": 1.126,
      "factor": 0.99894,
      "team": "SJS"
    },
    "8474062": {
      "shots": 1,
      "goals": 0,
      "xg": 0.04,
      "factor": 0.99997,
      "team": "NYR"
    },
    "8474090": {
      "shots": 153,
      "goals": 6,
      "xg": 8.319,
      "factor": 0.9347,
      "team": "NJD"
    },
    "8474102": {
      "shots": 428,
      "goals": 39,
      "xg": 35.139,
      "factor": 1.063,
      "team": "DET"
    },
    "8474141": {
      "shots": 702,
      "goals": 63,
      "xg": 53.908,
      "factor": 1.11688,
      "team": "DET"
    },
    "8474145": {
      "shots": 31,
      "goals": 0,
      "xg": 1.492,
      "factor": 0.97691,
      "team": "NYI"
    },
    "8474149": {
      "shots": 330,
      "goals": 33,
      "xg": 26.911,
      "factor": 1.11285,
      "team": "DAL"
    },
    "8474150": {
      "shots": 846,
      "goals": 47,
      "xg": 62.054,
      "factor": 0.82281,
      "team": "CGY"
    },
    "8474151": {
      "shots": 330,
      "goals": 13,
      "xg": 17.19,
      "factor": 0.89236,
      "team": "TBL"
    },
    "8474157": {
      "shots": 245,
      "goals": 9,
      "xg": 17.915,
      "factor": 0.82,
      "team": "WSH"
    },
    "8474166": {
      "shots": 174,
      "goals": 9,
      "xg": 8.126,
      "factor": 1.02666,
      "team": "VGK"
    },
    "8474189": {
      "shots": 465,
      "goals": 31,
      "xg": 37.107,
      "factor": 0.90239,
      "team": "PIT"
    },
    "8474563": {
      "shots": 405,
      "goals": 24,
      "xg": 21.961,
      "factor": 1.04713,
      "team": "LAK"
    },
    "8474564": {
      "shots": 944,
      "goals": 111,
      "xg": 77.243,
      "factor": 1.2,
      "team": "NSH"
    },
    "8474565": {
      "shots": 408,
      "goals": 8,
      "xg": 21.824,
      "factor": 0.82,
      "team": "VGK"
    },
    "8474567": {
      "shots": 293,
      "goals": 9,
      "xg": 13.311,
      "factor": 0.8747,
      "team": "MIN"
    },
    "8474568": {
      "shots": 277,
      "goals": 3,
      "xg": 13.163,
      "factor": 0.82,
      "team": "NSH"
    },
    "8474574": {
      "shots": 433,
      "goals": 12,
      "xg": 22.921,
      "factor": 0.82,
      "team": "VAN"
    },
    "8474578": {
      "shots": 897,
      "goals": 37,
      "xg": 47.05,
      "factor": 0.84795,
      "team": "PIT"
    },
    "8474586": {
      "shots": 618,
      "goals": 54,
      "xg": 55.768,
      "factor": 0.97853,
      "team": "SEA"
    },
    "8474590": {
      "shots": 780,
      "goals": 30,
      "xg": 45.937,
      "factor": 0.82,
      "team": "WSH"
    },
    "8474593": {
      "shots": 1,
      "goals": 0,
      "xg": 0.1,
      "factor": 0.99993,
      "team": "NJD"
    },
    "8474596": {
      "shots": 2,
      "goals": 0,
      "xg": 0.204,
      "factor": 0.99973,
      "team": "MTL"
    },
    "8474600": {
      "shots": 865,
      "goals": 45,
      "xg": 50.366,
      "factor": 0.92389,
      "team": "NSH"
    },
    "8474602": {
      "shots": 164,
      "goals": 7,
      "xg": 8.351,
      "factor": 0.9606,
      "team": "SEA"
    },
    "8474612": {
      "shots": 223,
      "goals": 3,
      "xg": 10.058,
      "factor": 0.82,
      "team": "OTT"
    },
    "8474618": {
      "shots": 67,
      "goals": 2,
      "xg": 3.43,
      "factor": 0.96605,
      "team": "STL"
    },
    "8474641": {
      "shots": 498,
      "goals": 39,
      "xg": 41.275,
      "factor": 0.96608,
      "team": "EDM"
    },
    "8474673": {
      "shots": 119,
      "goals": 3,
      "xg": 6.516,
      "factor": 0.9036,
      "team": "TOR"
    },
    "8474679": {
      "shots": 471,
      "goals": 38,
      "xg": 40.244,
      "factor": 0.96635,
      "team": "NSH"
    },
    "8474709": {
      "shots": 96,
      "goals": 4,
      "xg": 6.885,
      "factor": 0.93258,
      "team": "NYI"
    },
    "8474715": {
      "shots": 283,
      "goals": 17,
      "xg": 21.482,
      "factor": 0.90708,
      "team": "PHI"
    },
    "8474716": {
      "shots": 314,
      "goals": 13,
      "xg": 17.731,
      "factor": 0.88313,
      "team": "MIN"
    },
    "8474870": {
      "shots": 172,
      "goals": 17,
      "xg": 13.835,
      "factor": 1.07082,
      "team": "CHI"
    },
    "8474884": {
      "shots": 117,
      "goals": 10,
      "xg": 8.496,
      "factor": 1.03592,
      "team": "SJS"
    },
    "8475149": {
      "shots": 498,
      "goals": 37,
      "xg": 38.336,
      "factor": 0.97882,
      "team": "MIN"
    },
    "8475151": {
      "shots": 700,
      "goals": 62,
      "xg": 61.284,
      "factor": 1.00822,
      "team": "NYI"
    },
    "8475158": {
      "shots": 718,
      "goals": 79,
      "xg": 67.428,
      "factor": 1.12266,
      "team": "NSH"
    },
    "8475164": {
      "shots": 151,
      "goals": 7,
      "xg": 10.66,
      "factor": 0.91052,
      "team": "ANA"
    },
    "8475166": {
      "shots": 971,
      "goals": 98,
      "xg": 89.018,
      "factor": 1.0781,
      "team": "TOR"
    },
    "8475167": {
      "shots": 665,
      "goals": 31,
      "xg": 36.109,
      "factor": 0.90884,
      "team": "TBL"
    },
    "8475168": {
      "shots": 628,
      "goals": 78,
      "xg": 55.419,
      "factor": 1.2,
      "team": "DAL"
    },
    "8475169": {
      "shots": 586,
      "goals": 37,
      "xg": 45.019,
      "factor": 0.88429,
      "team": "EDM"
    },
    "8475170": {
      "shots": 673,
      "goals": 61,
      "xg": 56.559,
      "factor": 1.05428,
      "team": "STL"
    },
    "8475171": {
      "shots": 531,
      "goals": 21,
      "xg": 26.715,
      "factor": 0.87706,
      "team": "TOR"
    },
    "8475172": {
      "shots": 1113,
      "goals": 83,
      "xg": 89.408,
      "factor": 0.94337,
      "team": "CGY"
    },
    "8475177": {
      "shots": 179,
      "goals": 3,
      "xg": 8.512,
      "factor": 0.83356,
      "team": "TBL"
    },
    "8475179": {
      "shots": 242,
      "goals": 5,
      "xg": 12.092,
      "factor": 0.82,
      "team": "FLA"
    },
    "8475181": {
      "shots": 177,
      "goals": 6,
      "xg": 9.263,
      "factor": 0.90628,
      "team": "STL"
    },
    "8475184": {
      "shots": 815,
      "goals": 83,
      "xg": 72.6,
      "factor": 1.10569,
      "team": "NYR"
    },
    "8475188": {
      "shots": 405,
      "goals": 14,
      "xg": 20.776,
      "factor": 0.83698,
      "team": "VGK"
    },
    "8475191": {
      "shots": 527,
      "goals": 42,
      "xg": 42.415,
      "factor": 0.99386,
      "team": "PIT"
    },
    "8475193": {
      "shots": 211,
      "goals": 17,
      "xg": 17.308,
      "factor": 0.99343,
      "team": "NJD"
    },
    "8475197": {
      "shots": 120,
      "goals": 2,
      "xg": 6.48,
      "factor": 0.87624,
      "team": "NSH"
    },
    "8475200": {
      "shots": 546,
      "goals": 15,
      "xg": 29.64,
      "factor": 0.82,
      "team": "CAR"
    },
    "8475208": {
      "shots": 323,
      "goals": 11,
      "xg": 16.67,
      "factor": 0.85241,
      "team": "SEA"
    },
    "8475218": {
      "shots": 666,
      "goals": 26,
      "xg": 37.715,
      "factor": 0.82,
      "team": "EDM"
    },
    "8475220": {
      "shots": 318,
      "goals": 32,
      "xg": 27.824,
      "factor": 1.07444,
      "team": "MIN"
    },
    "8475225": {
      "shots": 298,
      "goals": 20,
      "xg": 21.446,
      "factor": 0.96938,
      "team": "DAL"
    },
    "8475231": {
      "shots": 398,
      "goals": 27,
      "xg": 32.651,
      "factor": 0.90428,
      "team": "NYI"
    },
    "8475233": {
      "shots": 147,
      "goals": 7,
      "xg": 7.612,
      "factor": 0.98237,
      "team": "MTL"
    },
    "8475235": {
      "shots": 147,
      "goals": 3,
      "xg": 10.501,
      "factor": 0.82,
      "team": "PHI"
    },
    "8475253": {
      "shots": 3,
      "goals": 0,
      "xg": 0.197,
      "factor": 0.99961,
      "team": "PHI"
    },
    "8475278": {
      "shots": 25,
      "goals": 0,
      "xg": 2.047,
      "factor": 0.97516,
      "team": "VGK"
    },
    "8475279": {
      "shots": 476,
      "goals": 14,
      "xg": 23.849,
      "factor": 0.82,
      "team": "DET"
    },
    "8475287": {
      "shots": 596,
      "goals": 42,
      "xg": 47.262,
      "factor": 0.92687,
      "team": "NJD"
    },
    "8475311": {
      "shots": 1,
      "goals": 0,
      "xg": 0.408,
      "factor": 0.99973,
      "team": "LAK"
    },
    "8475314": {
      "shots": 935,
      "goals": 68,
      "xg": 86.286,
      "factor": 0.83737,
      "team": "NYI"
    },
    "8475324": {
      "shots": 313,
      "goals": 8,
      "xg": 15.662,
      "factor": 0.82,
      "team": "OTT"
    },
    "8475343": {
      "shots": 323,
      "goals": 32,
      "xg": 27.971,
      "factor": 1.07193,
      "team": "WSH"
    },
    "8475413": {
      "shots": 71,
      "goals": 3,
      "xg": 5.29,
      "factor": 0.95126,
      "team": "NJD"
    },
    "8475455": {
      "shots": 304,
      "goals": 13,
      "xg": 14.15,
      "factor": 0.96739,
      "team": "NJD"
    },
    "8475461": {
      "shots": 1,
      "goals": 0,
      "xg": 0.04,
      "factor": 0.99997,
      "team": "UTA"
    },
    "8475462": {
      "shots": 393,
      "goals": 9,
      "xg": 17.84,
      "factor": 0.82,
      "team": "ANA"
    },
    "8475683": {
      "shots": 3,
      "goals": 0,
      "xg": 0.284,
      "factor": 0.99944,
      "team": "FLA"
    },
    "8475690": {
      "shots": 152,
      "goals": 5,
      "xg": 7.241,
      "factor": 0.93267,
      "team": "TOR"
    },
    "8475692": {
      "shots": 680,
      "goals": 52,
      "xg": 50.732,
      "factor": 1.01707,
      "team": "MIN"
    },
    "8475714": {
      "shots": 211,
      "goals": 17,
      "xg": 16.672,
      "factor": 1.00717,
      "team": "TOR"
    },
    "8475718": {
      "shots": 114,
      "goals": 3,
      "xg": 5.668,
      "factor": 0.92432,
      "team": "DET"
    },
    "8475722": {
      "shots": 646,
      "goals": 59,
      "xg": 53.085,
      "factor": 1.07574,
      "team": "BUF"
    },
    "8475726": {
      "shots": 904,
      "goals": 83,
      "xg": 73.606,
      "factor": 1.09599,
      "team": "SJS"
    },
    "8475744": {
      "shots": 149,
      "goals": 11,
      "xg": 12.472,
      "factor": 0.96745,
      "team": "WSH"
    },
    "8475745": {
      "shots": 605,
      "goals": 70,
      "xg": 54.849,
      "factor": 1.1858,
      "team": "BOS"
    },
    "8475750": {
      "shots": 140,
      "goals": 6,
      "xg": 6.975,
      "factor": 0.97152,
      "team": "MIN"
    },
    "8475752": {
      "shots": 88,
      "goals": 3,
      "xg": 6.631,
      "factor": 0.91851,
      "team": "NYR"
    },
    "8475753": {
      "shots": 563,
      "goals": 22,
      "xg": 30.815,
      "factor": 0.82792,
      "team": "STL"
    },
    "8475754": {
      "shots": 888,
      "goals": 94,
      "xg": 76.35,
      "factor": 1.17399,
      "team": "NYI"
    },
    "8475755": {
      "shots": 85,
      "goals": 2,
      "xg": 4.226,
      "factor": 0.9416,
      "team": "DAL"
    },
    "8475760": {
      "shots": 525,
      "goals": 38,
      "xg": 41.315,
      "factor": 0.94994,
      "team": "ARI"
    },
    "8475762": {
      "shots": 116,
      "goals": 2,
      "xg": 5.914,
      "factor": 0.88976,
      "team": "VAN"
    },
    "8475763": {
      "shots": 429,
      "goals": 31,
      "xg": 33.82,
      "factor": 0.9525,
      "team": "PIT"
    },
    "8475764": {
      "shots": 387,
      "goals": 18,
      "xg": 20.777,
      "factor": 0.93413,
      "team": "STL"
    },
    "8475765": {
      "shots": 635,
      "goals": 57,
      "xg": 50.053,
      "factor": 1.09323,
      "team": "MIN"
    },
    "8475766": {
      "shots": 43,
      "goals": 5,
      "xg": 2.879,
      "factor": 1.0376,
      "team": "TBL"
    },
    "8475768": {
      "shots": 576,
      "goals": 50,
      "xg": 48.664,
      "factor": 1.01797,
      "team": "SEA"
    },
    "8475780": {
      "shots": 60,
      "goals": 2,
      "xg": 4.31,
      "factor": 0.95308,
      "team": "COL"
    },
    "8475784": {
      "shots": 578,
      "goals": 46,
      "xg": 46.335,
      "factor": 0.9953,
      "team": "BUF"
    },
    "8475786": {
      "shots": 958,
      "goals": 112,
      "xg": 92.322,
      "factor": 1.16512,
      "team": "EDM"
    },
    "8475790": {
      "shots": 199,
      "goals": 7,
      "xg": 8.99,
      "factor": 0.93851,
      "team": "CBJ"
    },
    "8475791": {
      "shots": 452,
      "goals": 38,
      "xg": 35.001,
      "factor": 1.04988,
      "team": "CAR"
    },
    "8475793": {
      "shots": 104,
      "goals": 13,
      "xg": 8.47,
      "factor": 1.10071,
      "team": "COL"
    },
    "8475794": {
      "shots": 339,
      "goals": 41,
      "xg": 29.324,
      "factor": 1.2,
      "team": "DAL"
    },
    "8475795": {
      "shots": 34,
      "goals": 0,
      "xg": 1.467,
      "factor": 0.97538,
      "team": "WSH"
    },
    "8475797": {
      "shots": 44,
      "goals": 0,
      "xg": 2.086,
      "factor": 0.95938,
      "team": "CHI"
    },
    "8475798": {
      "shots": 618,
      "goals": 56,
      "xg": 50.506,
      "factor": 1.07272,
      "team": "SJS"
    },
    "8475799": {
      "shots": 566,
      "goals": 43,
      "xg": 46.185,
      "factor": 0.9554,
      "team": "WPG"
    },
    "8475810": {
      "shots": 878,
      "goals": 90,
      "xg": 75.536,
      "factor": 1.14369,
      "team": "PIT"
    },
    "8475825": {
      "shots": 87,
      "goals": 2,
      "xg": 3.979,
      "factor": 0.94618,
      "team": "DAL"
    },
    "8475842": {
      "shots": 371,
      "goals": 25,
      "xg": 27.994,
      "factor": 0.94399,
      "team": "NYR"
    },
    "8475848": {
      "shots": 621,
      "goals": 44,
      "xg": 51.691,
      "factor": 0.90011,
      "team": "MTL"
    },
    "8475855": {
      "shots": 109,
      "goals": 6,
      "xg": 9.747,
      "factor": 0.92036,
      "team": "CAR"
    },
    "8475857": {
      "shots": 12,
      "goals": 0,
      "xg": 0.529,
      "factor": 0.99612,
      "team": "NSH"
    },
    "8475906": {
      "shots": 189,
      "goals": 11,
      "xg": 9.759,
      "factor": 1.03578,
      "team": "SJS"
    },
    "8475913": {
      "shots": 560,
      "goals": 63,
      "xg": 49.042,
      "factor": 1.18518,
      "team": "VGK"
    },
    "8475958": {
      "shots": 40,
      "goals": 5,
      "xg": 3.448,
      "factor": 1.02465,
      "team": "WSH"
    },
    "8476278": {
      "shots": 306,
      "goals": 18,
      "xg": 22.579,
      "factor": 0.90572,
      "team": "DAL"
    },
    "8476292": {
      "shots": 438,
      "goals": 31,
      "xg": 35.507,
      "factor": 0.92658,
      "team": "NJD"
    },
    "8476312": {
      "shots": 449,
      "goals": 14,
      "xg": 23.315,
      "factor": 0.82,
      "team": "COL"
    },
    "8476329": {
      "shots": 19,
      "goals": 2,
      "xg": 1.616,
      "factor": 1.00381,
      "team": "ARI"
    },
    "8476331": {
      "shots": 390,
      "goals": 9,
      "xg": 17.84,
      "factor": 0.82,
      "team": "WPG"
    },
    "8476341": {
      "shots": 1,
      "goals": 0,
      "xg": 0.408,
      "factor": 0.99973,
      "team": "LAK"
    },
    "8476346": {
      "shots": 221,
      "goals": 13,
      "xg": 17.728,
      "factor": 0.89872,
      "team": "CBJ"
    },
    "8476372": {
      "shots": 446,
      "goals": 8,
      "xg": 21.905,
      "factor": 0.82,
      "team": "PHI"
    },
    "8476374": {
      "shots": 429,
      "goals": 21,
      "xg": 30.812,
      "factor": 0.82192,
      "team": "CBJ"
    },
    "8476389": {
      "shots": 892,
      "goals": 73,
      "xg": 78.876,
      "factor": 0.94372,
      "team": "NYR"
    },
    "8476391": {
      "shots": 9,
      "goals": 0,
      "xg": 0.687,
      "factor": 0.99624,
      "team": "COL"
    },
    "8476392": {
      "shots": 482,
      "goals": 33,
      "xg": 41.969,
      "factor": 0.86931,
      "team": "WPG"
    },
    "8476393": {
      "shots": 346,
      "goals": 22,
      "xg": 26.142,
      "factor": 0.9202,
      "team": "OTT"
    },
    "8476399": {
      "shots": 798,
      "goals": 65,
      "xg": 68.244,
      "factor": 0.96528,
      "team": "CGY"
    },
    "8476419": {
      "shots": 462,
      "goals": 42,
      "xg": 40.45,
      "factor": 1.02303,
      "team": "NYI"
    },
    "8476422": {
      "shots": 330,
      "goals": 7,
      "xg": 16.193,
      "factor": 0.82,
      "team": "NYI"
    },
    "8476425": {
      "shots": 7,
      "goals": 0,
      "xg": 0.491,
      "factor": 0.99783,
      "team": "CBJ"
    },
    "8476429": {
      "shots": 256,
      "goals": 5,
      "xg": 12.984,
      "factor": 0.82,
      "team": "NYI"
    },
    "8476432": {
      "shots": 560,
      "goals": 42,
      "xg": 46.647,
      "factor": 0.93565,
      "team": "CBJ"
    },
    "8476438": {
      "shots": 488,
      "goals": 42,
      "xg": 40.64,
      "factor": 1.02042,
      "team": "STL"
    },
    "8476441": {
      "shots": 393,
      "goals": 9,
      "xg": 19.145,
      "factor": 0.82,
      "team": "LAK"
    },
    "8476442": {
      "shots": 63,
      "goals": 2,
      "xg": 4.594,
      "factor": 0.9466,
      "team": "PIT"
    },
    "8476448": {
      "shots": 458,
      "goals": 43,
      "xg": 37.561,
      "factor": 1.08569,
      "team": "VGK"
    },
    "8476453": {
      "shots": 1223,
      "goals": 128,
      "xg": 93.47,
      "factor": 1.2,
      "team": "TBL"
    },
    "8476454": {
      "shots": 704,
      "goals": 61,
      "xg": 59.585,
      "factor": 1.01667,
      "team": "EDM"
    },
    "8476455": {
      "shots": 210,
      "goals": 14,
      "xg": 18.29,
      "factor": 0.91213,
      "team": "COL"
    },
    "8476456": {
      "shots": 550,
      "goals": 51,
      "xg": 46.728,
      "factor": 1.05882,
      "team": "CGY"
    },
    "8476457": {
      "shots": 516,
      "goals": 18,
      "xg": 26.942,
      "factor": 0.82,
      "team": "SEA"
    },
    "8476458": {
      "shots": 475,
      "goals": 29,
      "xg": 36.781,
      "factor": 0.874,
      "team": "ANA"
    },
    "8476459": {
      "shots": 990,
      "goals": 82,
      "xg": 73.945,
      "factor": 1.08317,
      "team": "NYR"
    },
    "8476460": {
      "shots": 773,
      "goals": 100,
      "xg": 71.032,
      "factor": 1.2,
      "team": "WPG"
    },
    "8476461": {
      "shots": 647,
      "goals": 41,
      "xg": 53.199,
      "factor": 0.84405,
      "team": "PHI"
    },
    "8476462": {
      "shots": 667,
      "goals": 27,
      "xg": 35.674,
      "factor": 0.8436,
      "team": "NJD"
    },
    "8476463": {
      "shots": 364,
      "goals": 15,
      "xg": 18.405,
      "factor": 0.91371,
      "team": "MIN"
    },
    "8476467": {
      "shots": 381,
      "goals": 11,
      "xg": 20.328,
      "factor": 0.82,
      "team": "SEA"
    },
    "8476468": {
      "shots": 757,
      "goals": 78,
      "xg": 62.373,
      "factor": 1.1794,
      "team": "VAN"
    },
    "8476469": {
      "shots": 479,
      "goals": 41,
      "xg": 36.888,
      "factor": 1.06658,
      "team": "MTL"
    },
    "8476473": {
      "shots": 292,
      "goals": 9,
      "xg": 14.577,
      "factor": 0.84718,
      "team": "CHI"
    },
    "8476474": {
      "shots": 509,
      "goals": 39,
      "xg": 44.01,
      "factor": 0.92884,
      "team": "NJD"
    },
    "8476479": {
      "shots": 537,
      "goals": 31,
      "xg": 43.902,
      "factor": 0.82,
      "team": "LAK"
    },
    "8476480": {
      "shots": 395,
      "goals": 30,
      "xg": 35.601,
      "factor": 0.91176,
      "team": "WPG"
    },
    "8476483": {
      "shots": 817,
      "goals": 78,
      "xg": 69.333,
      "factor": 1.09184,
      "team": "PIT"
    },
    "8476525": {
      "shots": 239,
      "goals": 8,
      "xg": 10.583,
      "factor": 0.9207,
      "team": "WPG"
    },
    "8476539": {
      "shots": 842,
      "goals": 78,
      "xg": 67.629,
      "factor": 1.11298,
      "team": "NSH"
    },
    "8476624": {
      "shots": 292,
      "goals": 14,
      "xg": 24.174,
      "factor": 0.82,
      "team": "SJS"
    },
    "8476792": {
      "shots": 232,
      "goals": 4,
      "xg": 13.73,
      "factor": 0.82,
      "team": "STL"
    },
    "8476822": {
      "shots": 225,
      "goals": 16,
      "xg": 18.832,
      "factor": 0.94137,
      "team": "TBL"
    },
    "8476826": {
      "shots": 528,
      "goals": 28,
      "xg": 41.155,
      "factor": 0.82,
      "team": "SEA"
    },
    "8476853": {
      "shots": 661,
      "goals": 25,
      "xg": 37.418,
      "factor": 0.82,
      "team": "TOR"
    },
    "8476854": {
      "shots": 333,
      "goals": 11,
      "xg": 18.197,
      "factor": 0.82167,
      "team": "BOS"
    },
    "8476856": {
      "shots": 257,
      "goals": 6,
      "xg": 13.572,
      "factor": 0.82,
      "team": "DAL"
    },
    "8476858": {
      "shots": 104,
      "goals": 6,
      "xg": 7.66,
      "factor": 0.96119,
      "team": "VAN"
    },
    "8476867": {
      "shots": 110,
      "goals": 4,
      "xg": 8.324,
      "factor": 0.89953,
      "team": "CBJ"
    },
    "8476869": {
      "shots": 669,
      "goals": 26,
      "xg": 35.739,
      "factor": 0.82455,
      "team": "NSH"
    },
    "8476871": {
      "shots": 349,
      "goals": 24,
      "xg": 26.782,
      "factor": 0.94722,
      "team": "VGK"
    },
    "8476872": {
      "shots": 567,
      "goals": 39,
      "xg": 43.05,
      "factor": 0.93978,
      "team": "PHI"
    },
    "8476873": {
      "shots": 279,
      "goals": 30,
      "xg": 24.849,
      "factor": 1.09531,
      "team": "NSH"
    },
    "8476874": {
      "shots": 241,
      "goals": 8,
      "xg": 13.39,
      "factor": 0.85576,
      "team": "UTA"
    },
    "8476875": {
      "shots": 637,
      "goals": 24,
      "xg": 35.871,
      "factor": 0.82,
      "team": "MTL"
    },
    "8476878": {
      "shots": 369,
      "goals": 19,
      "xg": 29.575,
      "factor": 0.82,
      "team": "TBL"
    },
    "8476879": {
      "shots": 357,
      "goals": 10,
      "xg": 18.895,
      "factor": 0.82,
      "team": "EDM"
    },
    "8476880": {
      "shots": 743,
      "goals": 81,
      "xg": 65.171,
      "factor": 1.17415,
      "team": "WSH"
    },
    "8476881": {
      "shots": 764,
      "goals": 73,
      "xg": 69.906,
      "factor": 1.03214,
      "team": "VGK"
    },
    "8476882": {
      "shots": 541,
      "goals": 58,
      "xg": 39.058,
      "factor": 1.2,
      "team": "CHI"
    },
    "8476884": {
      "shots": 5,
      "goals": 0,
      "xg": 0.197,
      "factor": 0.99935,
      "team": "DAL"
    },
    "8476885": {
      "shots": 566,
      "goals": 14,
      "xg": 29.352,
      "factor": 0.82,
      "team": "ANA"
    },
    "8476887": {
      "shots": 1335,
      "goals": 123,
      "xg": 98.014,
      "factor": 1.2,
      "team": "NSH"
    },
    "8476889": {
      "shots": 289,
      "goals": 15,
      "xg": 22.89,
      "factor": 0.84261,
      "team": "DAL"
    },
    "8476891": {
      "shots": 376,
      "goals": 3,
      "xg": 18.068,
      "factor": 0.82,
      "team": "PIT"
    },
    "8476892": {
      "shots": 564,
      "goals": 30,
      "xg": 30.613,
      "factor": 0.98797,
      "team": "STL"
    },
    "8476897": {
      "shots": 267,
      "goals": 17,
      "xg": 21.454,
      "factor": 0.90967,
      "team": "STL"
    },
    "8476902": {
      "shots": 437,
      "goals": 16,
      "xg": 25.945,
      "factor": 0.82,
      "team": "DAL"
    },
    "8476905": {
      "shots": 369,
      "goals": 46,
      "xg": 30.586,
      "factor": 1.2,
      "team": "SEA"
    },
    "8476906": {
      "shots": 607,
      "goals": 30,
      "xg": 31.623,
      "factor": 0.96841,
      "team": "CAR"
    },
    "8476907": {
      "shots": 14,
      "goals": 1,
      "xg": 1.078,
      "factor": 0.99938,
      "team": "VAN"
    },
    "8476913": {
      "shots": 89,
      "goals": 2,
      "xg": 6.796,
      "factor": 0.89276,
      "team": "MIN"
    },
    "8476915": {
      "shots": 1,
      "goals": 0,
      "xg": 0.04,
      "factor": 0.99997,
      "team": "MIN"
    },
    "8476917": {
      "shots": 515,
      "goals": 5,
      "xg": 25.216,
      "factor": 0.82,
      "team": "NYI"
    },
    "8476918": {
      "shots": 226,
      "goals": 18,
      "xg": 19.385,
      "factor": 0.97185,
      "team": "NYR"
    },
    "8476919": {
      "shots": 32,
      "goals": 4,
      "xg": 2.739,
      "factor": 1.01773,
      "team": "NJD"
    },
    "8476921": {
      "shots": 628,
      "goals": 42,
      "xg": 50.295,
      "factor": 0.88941,
      "team": "CAR"
    },
    "8476923": {
      "shots": 416,
      "goals": 24,
      "xg": 25.268,
      "factor": 0.9734,
      "team": "CBJ"
    },
    "8476925": {
      "shots": 437,
      "goals": 28,
      "xg": 38.158,
      "factor": 0.84413,
      "team": "NSH"
    },
    "8476927": {
      "shots": 365,
      "goals": 23,
      "xg": 28.76,
      "factor": 0.89506,
      "team": "VAN"
    },
    "8476931": {
      "shots": 332,
      "goals": 15,
      "xg": 17.821,
      "factor": 0.92916,
      "team": "TOR"
    },
    "8476932": {
      "shots": 1,
      "goals": 0,
      "xg": 0.06,
      "factor": 0.99996,
      "team": "FLA"
    },
    "8476934": {
      "shots": 74,
      "goals": 5,
      "xg": 6.015,
      "factor": 0.97891,
      "team": "ANA"
    },
    "8476952": {
      "shots": 40,
      "goals": 1,
      "xg": 3.003,
      "factor": 0.96691,
      "team": "WPG"
    },
    "8476958": {
      "shots": 537,
      "goals": 13,
      "xg": 28.325,
      "factor": 0.82,
      "team": "CAR"
    },
    "8476960": {
      "shots": 69,
      "goals": 3,
      "xg": 4.992,
      "factor": 0.95751,
      "team": "CHI"
    },
    "8476967": {
      "shots": 461,
      "goals": 11,
      "xg": 23.061,
      "factor": 0.82,
      "team": "EDM"
    },
    "8476979": {
      "shots": 277,
      "goals": 8,
      "xg": 14.401,
      "factor": 0.82679,
      "team": "NYR"
    },
    "8476981": {
      "shots": 532,
      "goals": 38,
      "xg": 46.507,
      "factor": 0.88338,
      "team": "MTL"
    },
    "8476988": {
      "shots": 30,
      "goals": 0,
      "xg": 1.326,
      "factor": 0.97969,
      "team": "SJS"
    },
    "8476994": {
      "shots": 219,
      "goals": 13,
      "xg": 16.521,
      "factor": 0.92118,
      "team": "MIN"
    },
    "8476999": {
      "shots": 1,
      "goals": 0,
      "xg": 0.399,
      "factor": 0.99974,
      "team": "OTT"
    },
    "8477015": {
      "shots": 510,
      "goals": 35,
      "xg": 41.951,
      "factor": 0.89714,
      "team": "EDM"
    },
    "8477018": {
      "shots": 194,
      "goals": 8,
      "xg": 9.575,
      "factor": 0.95351,
      "team": "VGK"
    },
    "8477021": {
      "shots": 355,
      "goals": 31,
      "xg": 30.36,
      "factor": 1.01108,
      "team": "UTA"
    },
    "8477034": {
      "shots": 48,
      "goals": 0,
      "xg": 2.123,
      "factor": 0.95585,
      "team": "CHI"
    },
    "8477070": {
      "shots": 222,
      "goals": 8,
      "xg": 17.727,
      "factor": 0.82,
      "team": "UTA"
    },
    "8477073": {
      "shots": 38,
      "goals": 2,
      "xg": 2.811,
      "factor": 0.98693,
      "team": "NJD"
    },
    "8477126": {
      "shots": 1,
      "goals": 0,
      "xg": 0.057,
      "factor": 0.99996,
      "team": "BOS"
    },
    "8477149": {
      "shots": 30,
      "goals": 1,
      "xg": 2.156,
      "factor": 0.98374,
      "team": "TBL"
    },
    "8477220": {
      "shots": 379,
      "goals": 12,
      "xg": 18.683,
      "factor": 0.8302,
      "team": "UTA"
    },
    "8477244": {
      "shots": 58,
      "goals": 1,
      "xg": 2.469,
      "factor": 0.96581,
      "team": "PIT"
    },
    "8477320": {
      "shots": 6,
      "goals": 0,
      "xg": 0.437,
      "factor": 0.99833,
      "team": "NYR"
    },
    "8477330": {
      "shots": 137,
      "goals": 11,
      "xg": 9.993,
      "factor": 1.02419,
      "team": "OTT"
    },
    "8477335": {
      "shots": 135,
      "goals": 2,
      "xg": 6.486,
      "factor": 0.86728,
      "team": "SJS"
    },
    "8477346": {
      "shots": 798,
      "goals": 32,
      "xg": 39.094,
      "factor": 0.87709,
      "team": "CGY"
    },
    "8477353": {
      "shots": 220,
      "goals": 10,
      "xg": 16.503,
      "factor": 0.85403,
      "team": "TBL"
    },
    "8477365": {
      "shots": 273,
      "goals": 7,
      "xg": 14.654,
      "factor": 0.82,
      "team": "BUF"
    },
    "8477369": {
      "shots": 277,
      "goals": 11,
      "xg": 14.144,
      "factor": 0.91394,
      "team": "VAN"
    },
    "8477380": {
      "shots": 345,
      "goals": 24,
      "xg": 24.22,
      "factor": 0.99551,
      "team": "NYR"
    },
    "8477384": {
      "shots": 69,
      "goals": 3,
      "xg": 3.364,
      "factor": 0.99113,
      "team": "ARI"
    },
    "8477392": {
      "shots": 124,
      "goals": 6,
      "xg": 9.836,
      "factor": 0.91227,
      "team": "NYI"
    },
    "8477401": {
      "shots": 35,
      "goals": 1,
      "xg": 2.699,
      "factor": 0.97415,
      "team": "SEA"
    },
    "8477402": {
      "shots": 754,
      "goals": 68,
      "xg": 65.226,
      "factor": 1.03058,
      "team": "STL"
    },
    "8477404": {
      "shots": 966,
      "goals": 114,
      "xg": 89.683,
      "factor": 1.2,
      "team": "TBL"
    },
    "8477406": {
      "shots": 213,
      "goals": 7,
      "xg": 18.034,
      "factor": 0.82,
      "team": "EDM"
    },
    "8477407": {
      "shots": 386,
      "goals": 44,
      "xg": 30.489,
      "factor": 1.2,
      "team": "NYI"
    },
    "8477409": {
      "shots": 962,
      "goals": 79,
      "xg": 75.855,
      "factor": 1.03159,
      "team": "FLA"
    },
    "8477416": {
      "shots": 731,
      "goals": 55,
      "xg": 53.792,
      "factor": 1.01568,
      "team": "SEA"
    },
    "8477419": {
      "shots": 1,
      "goals": 0,
      "xg": 0.04,
      "factor": 0.99997,
      "team": "BUF"
    },
    "8477425": {
      "shots": 423,
      "goals": 21,
      "xg": 32.978,
      "factor": 0.82,
      "team": "COL"
    },
    "8477426": {
      "shots": 530,
      "goals": 53,
      "xg": 43.978,
      "factor": 1.12957,
      "team": "TBL"
    },
    "8477429": {
      "shots": 436,
      "goals": 32,
      "xg": 38.391,
      "factor": 0.90249,
      "team": "DET"
    },
    "8477435": {
      "shots": 220,
      "goals": 5,
      "xg": 10.228,
      "factor": 0.84226,
      "team": "PIT"
    },
    "8477444": {
      "shots": 429,
      "goals": 29,
      "xg": 33.124,
      "factor": 0.92935,
      "team": "SEA"
    },
    "8477446": {
      "shots": 438,
      "goals": 25,
      "xg": 34.335,
      "factor": 0.84372,
      "team": "NSH"
    },
    "8477447": {
      "shots": 549,
      "goals": 25,
      "xg": 30.017,
      "factor": 0.90062,
      "team": "VGK"
    },
    "8477450": {
      "shots": 395,
      "goals": 36,
      "xg": 29.929,
      "factor": 1.10996,
      "team": "CHI"
    },
    "8477451": {
      "shots": 770,
      "goals": 55,
      "xg": 59.338,
      "factor": 0.94779,
      "team": "MIN"
    },
    "8477454": {
      "shots": 83,
      "goals": 7,
      "xg": 6.961,
      "factor": 1.00082,
      "team": "DAL"
    },
    "8477456": {
      "shots": 423,
      "goals": 41,
      "xg": 37.319,
      "factor": 1.05699,
      "team": "DET"
    },
    "8477462": {
      "shots": 8,
      "goals": 0,
      "xg": 0.337,
      "factor": 0.99828,
      "team": "ANA"
    },
    "8477463": {
      "shots": 11,
      "goals": 0,
      "xg": 0.496,
      "factor": 0.99664,
      "team": "TBL"
    },
    "8477464": {
      "shots": 14,
      "goals": 0,
      "xg": 1.048,
      "factor": 0.99164,
      "team": "MIN"
    },
    "8477465": {
      "shots": 4,
      "goals": 1,
      "xg": 0.686,
      "factor": 1.00079,
      "team": "PIT"
    },
    "8477473": {
      "shots": 101,
      "goals": 5,
      "xg": 6.668,
      "factor": 0.95912,
      "team": "SJS"
    },
    "8477476": {
      "shots": 604,
      "goals": 65,
      "xg": 55.901,
      "factor": 1.10971,
      "team": "COL"
    },
    "8477478": {
      "shots": 309,
      "goals": 17,
      "xg": 25.05,
      "factor": 0.84609,
      "team": "CAR"
    },
    "8477479": {
      "shots": 703,
      "goals": 76,
      "xg": 60.537,
      "factor": 1.17963,
      "team": "CHI"
    },
    "8477482": {
      "shots": 40,
      "goals": 0,
      "xg": 3.439,
      "factor": 0.94534,
      "team": "CHI"
    },
    "8477488": {
      "shots": 387,
      "goals": 7,
      "xg": 19.506,
      "factor": 0.82,
      "team": "NJD"
    },
    "8477492": {
      "shots": 1444,
      "goals": 140,
      "xg": 114.563,
      "factor": 1.18454,
      "team": "COL"
    },
    "8477493": {
      "shots": 528,
      "goals": 49,
      "xg": 41.835,
      "factor": 1.10722,
      "team": "FLA"
    },
    "8477494": {
      "shots": 415,
      "goals": 34,
      "xg": 35.667,
      "factor": 0.97337,
      "team": "COL"
    },
    "8477495": {
      "shots": 578,
      "goals": 24,
      "xg": 30.421,
      "factor": 0.87257,
      "team": "CHI"
    },
    "8477496": {
      "shots": 682,
      "goals": 49,
      "xg": 56.642,
      "factor": 0.90646,
      "team": "BOS"
    },
    "8477497": {
      "shots": 592,
      "goals": 60,
      "xg": 51.638,
      "factor": 1.10751,
      "team": "CBJ"
    },
    "8477498": {
      "shots": 766,
      "goals": 22,
      "xg": 40.424,
      "factor": 0.82,
      "team": "EDM"
    },
    "8477499": {
      "shots": 296,
      "goals": 6,
      "xg": 17.445,
      "factor": 0.82,
      "team": "PHI"
    },
    "8477500": {
      "shots": 1030,
      "goals": 97,
      "xg": 83.799,
      "factor": 1.12242,
      "team": "NYI"
    },
    "8477501": {
      "shots": 654,
      "goals": 72,
      "xg": 56.662,
      "factor": 1.18601,
      "team": "COL"
    },
    "8477503": {
      "shots": 502,
      "goals": 31,
      "xg": 35.618,
      "factor": 0.92207,
      "team": "TOR"
    },
    "8477504": {
      "shots": 789,
      "goals": 38,
      "xg": 42.297,
      "factor": 0.93044,
      "team": "WPG"
    },
    "8477505": {
      "shots": 378,
      "goals": 38,
      "xg": 32.734,
      "factor": 1.08758,
      "team": "SJS"
    },
    "8477506": {
      "shots": 415,
      "goals": 13,
      "xg": 20.14,
      "factor": 0.82303,
      "team": "NYI"
    },
    "8477507": {
      "shots": 484,
      "goals": 12,
      "xg": 25.509,
      "factor": 0.82,
      "team": "BOS"
    },
    "8477508": {
      "shots": 189,
      "goals": 13,
      "xg": 15.352,
      "factor": 0.94842,
      "team": "NJD"
    },
    "8477511": {
      "shots": 406,
      "goals": 61,
      "xg": 32.89,
      "factor": 1.2,
      "team": "PIT"
    },
    "8477527": {
      "shots": 138,
      "goals": 5,
      "xg": 11.271,
      "factor": 0.85878,
      "team": "ANA"
    },
    "8477541": {
      "shots": 92,
      "goals": 4,
      "xg": 4.68,
      "factor": 0.98187,
      "team": "MIN"
    },
    "8477573": {
      "shots": 218,
      "goals": 19,
      "xg": 15.879,
      "factor": 1.07159,
      "team": "STL"
    },
    "8477810": {
      "shots": 192,
      "goals": 3,
      "xg": 8.89,
      "factor": 0.82002,
      "team": "CGY"
    },
    "8477839": {
      "shots": 201,
      "goals": 11,
      "xg": 16.104,
      "factor": 0.88829,
      "team": "NYR"
    },
    "8477845": {
      "shots": 296,
      "goals": 4,
      "xg": 15.12,
      "factor": 0.82,
      "team": "WSH"
    },
    "8477846": {
      "shots": 87,
      "goals": 5,
      "xg": 6.765,
      "factor": 0.96104,
      "team": "SJS"
    },
    "8477851": {
      "shots": 90,
      "goals": 4,
      "xg": 4.809,
      "factor": 0.97895,
      "team": "BOS"
    },
    "8477887": {
      "shots": 27,
      "goals": 0,
      "xg": 1.855,
      "factor": 0.97545,
      "team": "BOS"
    },
    "8477903": {
      "shots": 328,
      "goals": 18,
      "xg": 25.82,
      "factor": 0.8507,
      "team": "PHI"
    },
    "8477919": {
      "shots": 421,
      "goals": 32,
      "xg": 32.054,
      "factor": 0.99906,
      "team": "MIN"
    },
    "8477930": {
      "shots": 52,
      "goals": 4,
      "xg": 3.931,
      "factor": 1.00129,
      "team": "SEA"
    },
    "8477931": {
      "shots": 160,
      "goals": 5,
      "xg": 12.418,
      "factor": 0.82903,
      "team": "FLA"
    },
    "8477932": {
      "shots": 484,
      "goals": 11,
      "xg": 25.208,
      "factor": 0.82,
      "team": "FLA"
    },
    "8477933": {
      "shots": 984,
      "goals": 133,
      "xg": 87.917,
      "factor": 1.2,
      "team": "FLA"
    },
    "8477934": {
      "shots": 966,
      "goals": 131,
      "xg": 84.45,
      "factor": 1.2,
      "team": "EDM"
    },
    "8477935": {
      "shots": 893,
      "goals": 71,
      "xg": 73.954,
      "factor": 0.97,
      "team": "FLA"
    },
    "8477938": {
      "shots": 141,
      "goals": 3,
      "xg": 7.476,
      "factor": 0.87296,
      "team": "WPG"
    },
    "8477939": {
      "shots": 1028,
      "goals": 119,
      "xg": 81.19,
      "factor": 1.2,
      "team": "TOR"
    },
    "8477940": {
      "shots": 936,
      "goals": 75,
      "xg": 66.58,
      "factor": 1.09469,
      "team": "WPG"
    },
    "8477942": {
      "shots": 980,
      "goals": 85,
      "xg": 73.676,
      "factor": 1.11713,
      "team": "LAK"
    },
    "8477944": {
      "shots": 123,
      "goals": 11,
      "xg": 8.457,
      "factor": 1.06273,
      "team": "STL"
    },
    "8477946": {
      "shots": 1017,
      "goals": 99,
      "xg": 84.891,
      "factor": 1.12904,
      "team": "DET"
    },
    "8477947": {
      "shots": 121,
      "goals": 21,
      "xg": 10.631,
      "factor": 1.2,
      "team": "WSH"
    },
    "8477948": {
      "shots": 590,
      "goals": 29,
      "xg": 35.66,
      "factor": 0.88311,
      "team": "PHI"
    },
    "8477949": {
      "shots": 933,
      "goals": 97,
      "xg": 75.262,
      "factor": 1.2,
      "team": "BUF"
    },
    "8477950": {
      "shots": 372,
      "goals": 12,
      "xg": 19.68,
      "factor": 0.82,
      "team": "NYI"
    },
    "8477951": {
      "shots": 809,
      "goals": 77,
      "xg": 67.638,
      "factor": 1.10125,
      "team": "UTA"
    },
    "8477952": {
      "shots": 258,
      "goals": 28,
      "xg": 22.129,
      "factor": 1.11478,
      "team": "DET"
    },
    "8477953": {
      "shots": 340,
      "goals": 20,
      "xg": 25.252,
      "factor": 0.89672,
      "team": "EDM"
    },
    "8477955": {
      "shots": 813,
      "goals": 71,
      "xg": 61.359,
      "factor": 1.11381,
      "team": "SEA"
    },
    "8477956": {
      "shots": 1373,
      "goals": 121,
      "xg": 101.173,
      "factor": 1.16056,
      "team": "BOS"
    },
    "8477960": {
      "shots": 1086,
      "goals": 109,
      "xg": 79.611,
      "factor": 1.2,
      "team": "LAK"
    },
    "8477962": {
      "shots": 43,
      "goals": 3,
      "xg": 3.263,
      "factor": 0.9955,
      "team": "CAR"
    },
    "8477964": {
      "shots": 562,
      "goals": 65,
      "xg": 48.614,
      "factor": 1.2,
      "team": "VGK"
    },
    "8477968": {
      "shots": 1,
      "goals": 1,
      "xg": 0.408,
      "factor": 1.00039,
      "team": "PIT"
    },
    "8477969": {
      "shots": 430,
      "goals": 11,
      "xg": 21.684,
      "factor": 0.82,
      "team": "PIT"
    },
    "8477971": {
      "shots": 84,
      "goals": 2,
      "xg": 4.136,
      "factor": 0.944,
      "team": "LAK"
    },
    "8477979": {
      "shots": 141,
      "goals": 7,
      "xg": 9.989,
      "factor": 0.92701,
      "team": "WSH"
    },
    "8477986": {
      "shots": 865,
      "goals": 37,
      "xg": 48.473,
      "factor": 0.83183,
      "team": "SEA"
    },
    "8477987": {
      "shots": 680,
      "goals": 60,
      "xg": 55.037,
      "factor": 1.06225,
      "team": "CHI"
    },
    "8477989": {
      "shots": 440,
      "goals": 35,
      "xg": 39.102,
      "factor": 0.93819,
      "team": "PHI"
    },
    "8477993": {
      "shots": 45,
      "goals": 6,
      "xg": 3.575,
      "factor": 1.0419,
      "team": "CGY"
    },
    "8477996": {
      "shots": 22,
      "goals": 0,
      "xg": 1.886,
      "factor": 0.97922,
      "team": "NJD"
    },
    "8477998": {
      "shots": 767,
      "goals": 57,
      "xg": 60.662,
      "factor": 0.95681,
      "team": "LAK"
    },
    "8478009": {
      "shots": 1,
      "goals": 1,
      "xg": 0.429,
      "factor": 1.00037,
      "team": "NYI"
    },
    "8478010": {
      "shots": 794,
      "goals": 111,
      "xg": 74.209,
      "factor": 1.2,
      "team": "TBL"
    },
    "8478011": {
      "shots": 14,
      "goals": 2,
      "xg": 0.898,
      "factor": 1.00894,
      "team": "PHI"
    },
    "8478013": {
      "shots": 532,
      "goals": 27,
      "xg": 28.514,
      "factor": 0.96902,
      "team": "SJS"
    },
    "8478017": {
      "shots": 39,
      "goals": 0,
      "xg": 1.686,
      "factor": 0.969,
      "team": "VAN"
    },
    "8478020": {
      "shots": 427,
      "goals": 40,
      "xg": 35.874,
      "factor": 1.06615,
      "team": "OTT"
    },
    "8478021": {
      "shots": 38,
      "goals": 0,
      "xg": 1.893,
      "factor": 0.96665,
      "team": "TOR"
    },
    "8478028": {
      "shots": 53,
      "goals": 3,
      "xg": 4.165,
      "factor": 0.97822,
      "team": "COL"
    },
    "8478038": {
      "shots": 603,
      "goals": 25,
      "xg": 33.125,
      "factor": 0.84785,
      "team": "COL"
    },
    "8478042": {
      "shots": 577,
      "goals": 48,
      "xg": 43.7,
      "factor": 1.0634,
      "team": "BOS"
    },
    "8478043": {
      "shots": 197,
      "goals": 18,
      "xg": 15.613,
      "factor": 1.05282,
      "team": "VAN"
    },
    "8478046": {
      "shots": 362,
      "goals": 32,
      "xg": 28.162,
      "factor": 1.07088,
      "team": "BOS"
    },
    "8478047": {
      "shots": 703,
      "goals": 52,
      "xg": 56.793,
      "factor": 0.94111,
      "team": "NSH"
    },
    "8478048": {
      "shots": 4,
      "goals": 0,
      "xg": 0.75,
      "factor": 0.99814,
      "team": "NYR"
    },
    "8478051": {
      "shots": 18,
      "goals": 3,
      "xg": 1.28,
      "factor": 1.01685,
      "team": "NJD"
    },
    "8478055": {
      "shots": 662,
      "goals": 23,
      "xg": 32.518,
      "factor": 0.82,
      "team": "FLA"
    },
    "8478056": {
      "shots": 4,
      "goals": 1,
      "xg": 0.381,
      "factor": 1.00161,
      "team": "CGY"
    },
    "8478057": {
      "shots": 286,
      "goals": 35,
      "xg": 26.056,
      "factor": 1.16118,
      "team": "VAN"
    },
    "8478062": {
      "shots": 5,
      "goals": 0,
      "xg": 0.209,
      "factor": 0.99931,
      "team": "CBJ"
    },
    "8478078": {
      "shots": 52,
      "goals": 2,
      "xg": 4.051,
      "factor": 0.96185,
      "team": "OTT"
    },
    "8478099": {
      "shots": 146,
      "goals": 5,
      "xg": 9.624,
      "factor": 0.8825,
      "team": "SJS"
    },
    "8478104": {
      "shots": 71,
      "goals": 4,
      "xg": 5.975,
      "factor": 0.96002,
      "team": "STL"
    },
    "8478109": {
      "shots": 459,
      "goals": 37,
      "xg": 33.789,
      "factor": 1.05518,
      "team": "VGK"
    },
    "8478115": {
      "shots": 293,
      "goals": 18,
      "xg": 22.615,
      "factor": 0.90662,
      "team": "NYI"
    },
    "8478133": {
      "shots": 369,
      "goals": 32,
      "xg": 33.223,
      "factor": 0.98006,
      "team": "MTL"
    },
    "8478136": {
      "shots": 351,
      "goals": 17,
      "xg": 20.15,
      "factor": 0.92603,
      "team": "MIN"
    },
    "8478146": {
      "shots": 59,
      "goals": 2,
      "xg": 4.492,
      "factor": 0.95075,
      "team": "OTT"
    },
    "8478147": {
      "shots": 20,
      "goals": 1,
      "xg": 1.261,
      "factor": 0.99718,
      "team": "PIT"
    },
    "8478173": {
      "shots": 13,
      "goals": 0,
      "xg": 1.021,
      "factor": 0.99238,
      "team": "OTT"
    },
    "8478178": {
      "shots": 662,
      "goals": 34,
      "xg": 32.656,
      "factor": 1.02598,
      "team": "TBL"
    },
    "8478211": {
      "shots": 56,
      "goals": 3,
      "xg": 4.324,
      "factor": 0.97451,
      "team": "CGY"
    },
    "8478233": {
      "shots": 436,
      "goals": 36,
      "xg": 37.873,
      "factor": 0.9711,
      "team": "CGY"
    },
    "8478366": {
      "shots": 803,
      "goals": 63,
      "xg": 59.724,
      "factor": 1.03951,
      "team": "ANA"
    },
    "8478396": {
      "shots": 672,
      "goals": 26,
      "xg": 35.39,
      "factor": 0.82931,
      "team": "VGK"
    },
    "8478397": {
      "shots": 779,
      "goals": 39,
      "xg": 43.478,
      "factor": 0.92934,
      "team": "CGY"
    },
    "8478398": {
      "shots": 1050,
      "goals": 117,
      "xg": 86.556,
      "factor": 1.2,
      "team": "WPG"
    },
    "8478399": {
      "shots": 271,
      "goals": 3,
      "xg": 14.123,
      "factor": 0.82,
      "team": "NJD"
    },
    "8478400": {
      "shots": 36,
      "goals": 0,
      "xg": 2.776,
      "factor": 0.95706,
      "team": "MTL"
    },
    "8478401": {
      "shots": 616,
      "goals": 65,
      "xg": 54.227,
      "factor": 1.13397,
      "team": "BOS"
    },
    "8478402": {
      "shots": 1068,
      "goals": 109,
      "xg": 97.994,
      "factor": 1.08886,
      "team": "EDM"
    },
    "8478403": {
      "shots": 1032,
      "goals": 90,
      "xg": 77.381,
      "factor": 1.12585,
      "team": "VGK"
    },
    "8478406": {
      "shots": 1,
      "goals": 0,
      "xg": 0.06,
      "factor": 0.99996,
      "team": "COL"
    },
    "8478407": {
      "shots": 600,
      "goals": 33,
      "xg": 31.213,
      "factor": 1.03505,
      "team": "SEA"
    },
    "8478408": {
      "shots": 70,
      "goals": 2,
      "xg": 3.397,
      "factor": 0.96568,
      "team": "ARI"
    },
    "8478409": {
      "shots": 41,
      "goals": 3,
      "xg": 3.09,
      "factor": 0.9985,
      "team": "PHI"
    },
    "8478413": {
      "shots": 267,
      "goals": 14,
      "xg": 19.63,
      "factor": 0.87829,
      "team": "BUF"
    },
    "8478414": {
      "shots": 1137,
      "goals": 79,
      "xg": 88.299,
      "factor": 0.91663,
      "team": "NJD"
    },
    "8478416": {
      "shots": 268,
      "goals": 8,
      "xg": 13.911,
      "factor": 0.83861,
      "team": "TBL"
    },
    "8478420": {
      "shots": 966,
      "goals": 100,
      "xg": 84.508,
      "factor": 1.14116,
      "team": "COL"
    },
    "8478421": {
      "shots": 374,
      "goals": 29,
      "xg": 30.559,
      "factor": 0.9727,
      "team": "FLA"
    },
    "8478424": {
      "shots": 174,
      "goals": 6,
      "xg": 12.662,
      "factor": 0.84152,
      "team": "ANA"
    },
    "8478427": {
      "shots": 971,
      "goals": 94,
      "xg": 77.196,
      "factor": 1.16639,
      "team": "CAR"
    },
    "8478430": {
      "shots": 80,
      "goals": 4,
      "xg": 4.153,
      "factor": 0.99613,
      "team": "CGY"
    },
    "8478432": {
      "shots": 165,
      "goals": 6,
      "xg": 12.739,
      "factor": 0.84459,
      "team": "DET"
    },
    "8478434": {
      "shots": 347,
      "goals": 26,
      "xg": 26.1,
      "factor": 0.99807,
      "team": "VGK"
    },
    "8478438": {
      "shots": 507,
      "goals": 47,
      "xg": 42.224,
      "factor": 1.07017,
      "team": "NSH"
    },
    "8478439": {
      "shots": 938,
      "goals": 89,
      "xg": 72.949,
      "factor": 1.16636,
      "team": "PHI"
    },
    "8478440": {
      "shots": 680,
      "goals": 82,
      "xg": 57.014,
      "factor": 1.2,
      "team": "WSH"
    },
    "8478443": {
      "shots": 344,
      "goals": 5,
      "xg": 17.283,
      "factor": 0.82,
      "team": "BOS"
    },
    "8478444": {
      "shots": 766,
      "goals": 88,
      "xg": 64.036,
      "factor": 1.2,
      "team": "VAN"
    },
    "8478445": {
      "shots": 732,
      "goals": 50,
      "xg": 58.864,
      "factor": 0.8936,
      "team": "NYI"
    },
    "8478446": {
      "shots": 1,
      "goals": 0,
      "xg": 0.092,
      "factor": 0.99994,
      "team": "ANA"
    },
    "8478449": {
      "shots": 665,
      "goals": 73,
      "xg": 59.643,
      "factor": 1.1554,
      "team": "DAL"
    },
    "8478450": {
      "shots": 206,
      "goals": 4,
      "xg": 9.722,
      "factor": 0.82769,
      "team": "BOS"
    },
    "8478451": {
      "shots": 42,
      "goals": 1,
      "xg": 2.297,
      "factor": 0.97617,
      "team": "WSH"
    },
    "8478452": {
      "shots": 44,
      "goals": 0,
      "xg": 2.172,
      "factor": 0.95805,
      "team": "COL"
    },
    "8478454": {
      "shots": 139,
      "goals": 2,
      "xg": 6.777,
      "factor": 0.85914,
      "team": "VAN"
    },
    "8478458": {
      "shots": 605,
      "goals": 52,
      "xg": 47.918,
      "factor": 1.05627,
      "team": "EDM"
    },
    "8478460": {
      "shots": 1106,
      "goals": 57,
      "xg": 63.792,
      "factor": 0.91863,
      "team": "CBJ"
    },
    "8478462": {
      "shots": 431,
      "goals": 36,
      "xg": 37.609,
      "factor": 0.97511,
      "team": "VGK"
    },
    "8478463": {
      "shots": 607,
      "goals": 38,
      "xg": 49.801,
      "factor": 0.84253,
      "team": "WSH"
    },
    "8478465": {
      "shots": 5,
      "goals": 0,
      "xg": 0.2,
      "factor": 0.99934,
      "team": "VAN"
    },
    "8478466": {
      "shots": 312,
      "goals": 20,
      "xg": 21.184,
      "factor": 0.97428,
      "team": "DET"
    },
    "8478468": {
      "shots": 313,
      "goals": 7,
      "xg": 16.329,
      "factor": 0.82,
      "team": "NSH"
    },
    "8478469": {
      "shots": 573,
      "goals": 25,
      "xg": 31.486,
      "factor": 0.87501,
      "team": "OTT"
    },
    "8478472": {
      "shots": 362,
      "goals": 17,
      "xg": 28.269,
      "factor": 0.82,
      "team": "OTT"
    },
    "8478474": {
      "shots": 655,
      "goals": 59,
      "xg": 54.103,
      "factor": 1.06185,
      "team": "UTA"
    },
    "8478476": {
      "shots": 32,
      "goals": 2,
      "xg": 1.56,
      "factor": 1.00695,
      "team": "DAL"
    },
    "8478477": {
      "shots": 51,
      "goals": 3,
      "xg": 3.764,
      "factor": 0.98567,
      "team": "SEA"
    },
    "8478483": {
      "shots": 775,
      "goals": 84,
      "xg": 59.372,
      "factor": 1.2,
      "team": "TOR"
    },
    "8478493": {
      "shots": 830,
      "goals": 63,
      "xg": 70.881,
      "factor": 0.91789,
      "team": "MIN"
    },
    "8478495": {
      "shots": 39,
      "goals": 1,
      "xg": 2.674,
      "factor": 0.97206,
      "team": "NSH"
    },
    "8478498": {
      "shots": 831,
      "goals": 77,
      "xg": 71.7,
      "factor": 1.05466,
      "team": "VAN"
    },
    "8478500": {
      "shots": 531,
      "goals": 21,
      "xg": 28.012,
      "factor": 0.85458,
      "team": "CBJ"
    },
    "8478502": {
      "shots": 57,
      "goals": 1,
      "xg": 2.742,
      "factor": 0.96101,
      "team": "CGY"
    },
    "8478507": {
      "shots": 220,
      "goals": 9,
      "xg": 13.498,
      "factor": 0.88492,
      "team": "UTA"
    },
    "8478508": {
      "shots": 484,
      "goals": 25,
      "xg": 39.093,
      "factor": 0.82,
      "team": "MIN"
    },
    "8478512": {
      "shots": 38,
      "goals": 0,
      "xg": 3.139,
      "factor": 0.95088,
      "team": "DET"
    },
    "8478519": {
      "shots": 606,
      "goals": 70,
      "xg": 54.544,
      "factor": 1.19053,
      "team": "TBL"
    },
    "8478542": {
      "shots": 756,
      "goals": 40,
      "xg": 54.286,
      "factor": 0.82,
      "team": "FLA"
    },
    "8478550": {
      "shots": 1207,
      "goals": 120,
      "xg": 86.744,
      "factor": 1.2,
      "team": "NYR"
    },
    "8478569": {
      "shots": 324,
      "goals": 22,
      "xg": 28.488,
      "factor": 0.8857,
      "team": "PIT"
    },
    "8478585": {
      "shots": 103,
      "goals": 7,
      "xg": 8.591,
      "factor": 0.96509,
      "team": "EDM"
    },
    "8478831": {
      "shots": 373,
      "goals": 29,
      "xg": 30.035,
      "factor": 0.98165,
      "team": "UTA"
    },
    "8478840": {
      "shots": 380,
      "goals": 13,
      "xg": 18.041,
      "factor": 0.86865,
      "team": "SEA"
    },
    "8478841": {
      "shots": 18,
      "goals": 0,
      "xg": 0.951,
      "factor": 0.99034,
      "team": "NJD"
    },
    "8478851": {
      "shots": 334,
      "goals": 14,
      "xg": 17.605,
      "factor": 0.9085,
      "team": "MTL"
    },
    "8478854": {
      "shots": 186,
      "goals": 9,
      "xg": 9.847,
      "factor": 0.97589,
      "team": "PIT"
    },
    "8478856": {
      "shots": 770,
      "goals": 52,
      "xg": 61.033,
      "factor": 0.89395,
      "team": "VAN"
    },
    "8478859": {
      "shots": 429,
      "goals": 12,
      "xg": 22.999,
      "factor": 0.82,
      "team": "FLA"
    },
    "8478864": {
      "shots": 1055,
      "goals": 118,
      "xg": 88.773,
      "factor": 1.2,
      "team": "MIN"
    },
    "8478873": {
      "shots": 798,
      "goals": 64,
      "xg": 63.206,
      "factor": 1.0091,
      "team": "ANA"
    },
    "8478874": {
      "shots": 284,
      "goals": 36,
      "xg": 23.014,
      "factor": 1.2,
      "team": "SJS"
    },
    "8478881": {
      "shots": 2,
      "goals": 0,
      "xg": 0.112,
      "factor": 0.99985,
      "team": "CHI"
    },
    "8478882": {
      "shots": 510,
      "goals": 25,
      "xg": 27.604,
      "factor": 0.94595,
      "team": "LAK"
    },
    "8478888": {
      "shots": 2,
      "goals": 1,
      "xg": 0.2,
      "factor": 1.00107,
      "team": "DAL"
    },
    "8478891": {
      "shots": 433,
      "goals": 30,
      "xg": 32.828,
      "factor": 0.95108,
      "team": "WPG"
    },
    "8478904": {
      "shots": 262,
      "goals": 16,
      "xg": 20.39,
      "factor": 0.90834,
      "team": "TOR"
    },
    "8478911": {
      "shots": 499,
      "goals": 10,
      "xg": 25.74,
      "factor": 0.82,
      "team": "WSH"
    },
    "8478916": {
      "shots": 7,
      "goals": 0,
      "xg": 1.628,
      "factor": 0.99367,
      "team": "SEA"
    },
    "8478967": {
      "shots": 2,
      "goals": 0,
      "xg": 0.192,
      "factor": 0.99974,
      "team": "PHI"
    },
    "8478970": {
      "shots": 501,
      "goals": 17,
      "xg": 24.408,
      "factor": 0.83183,
      "team": "CAR"
    },
    "8478975": {
      "shots": 628,
      "goals": 63,
      "xg": 51.773,
      "factor": 1.14599,
      "team": "DAL"
    },
    "8479022": {
      "shots": 101,
      "goals": 5,
      "xg": 8.215,
      "factor": 0.92874,
      "team": "PHI"
    },
    "8479026": {
      "shots": 149,
      "goals": 2,
      "xg": 6.764,
      "factor": 0.85386,
      "team": "TOR"
    },
    "8479066": {
      "shots": 290,
      "goals": 12,
      "xg": 21.371,
      "factor": 0.82,
      "team": "CGY"
    },
    "8479249": {
      "shots": 5,
      "goals": 0,
      "xg": 0.325,
      "factor": 0.99895,
      "team": "SJS"
    },
    "8479291": {
      "shots": 111,
      "goals": 9,
      "xg": 8.61,
      "factor": 1.00896,
      "team": "CGY"
    },
    "8479292": {
      "shots": 1,
      "goals": 0,
      "xg": 0.037,
      "factor": 0.99997,
      "team": "WSH"
    },
    "8479293": {
      "shots": 339,
      "goals": 17,
      "xg": 27.864,
      "factor": 0.82,
      "team": "SEA"
    },
    "8479314": {
      "shots": 780,
      "goals": 61,
      "xg": 67.015,
      "factor": 0.93485,
      "team": "FLA"
    },
    "8479315": {
      "shots": 100,
      "goals": 5,
      "xg": 7.236,
      "factor": 0.94759,
      "team": "CHI"
    },
    "8479316": {
      "shots": 382,
      "goals": 26,
      "xg": 30.285,
      "factor": 0.92392,
      "team": "SJS"
    },
    "8479318": {
      "shots": 1266,
      "goals": 134,
      "xg": 108.107,
      "factor": 1.19525,
      "team": "TOR"
    },
    "8479320": {
      "shots": 1,
      "goals": 0,
      "xg": 0.04,
      "factor": 0.99997,
      "team": "TOR"
    },
    "8479321": {
      "shots": 6,
      "goals": 0,
      "xg": 0.394,
      "factor": 0.99848,
      "team": "WSH"
    },
    "8479323": {
      "shots": 559,
      "goals": 36,
      "xg": 35.52,
      "factor": 1.00834,
      "team": "NYR"
    },
    "8479324": {
      "shots": 306,
      "goals": 9,
      "xg": 16.077,
      "factor": 0.82,
      "team": "NYR"
    },
    "8479325": {
      "shots": 527,
      "goals": 31,
      "xg": 30.851,
      "factor": 1.00286,
      "team": "BOS"
    },
    "8479328": {
      "shots": 43,
      "goals": 5,
      "xg": 3.067,
      "factor": 1.03368,
      "team": "NYI"
    },
    "8479330": {
      "shots": 9,
      "goals": 1,
      "xg": 0.794,
      "factor": 1.00112,
      "team": "MTL"
    },
    "8479335": {
      "shots": 3,
      "goals": 0,
      "xg": 0.257,
      "factor": 0.99949,
      "team": "FLA"
    },
    "8479336": {
      "shots": 347,
      "goals": 21,
      "xg": 25.522,
      "factor": 0.91118,
      "team": "LAK"
    },
    "8479337": {
      "shots": 1156,
      "goals": 108,
      "xg": 92.769,
      "factor": 1.13078,
      "team": "DET"
    },
    "8479339": {
      "shots": 247,
      "goals": 28,
      "xg": 16.634,
      "factor": 1.2,
      "team": "MTL"
    },
    "8479341": {
      "shots": 14,
      "goals": 0,
      "xg": 0.819,
      "factor": 0.9933,
      "team": "EDM"
    },
    "8479343": {
      "shots": 1008,
      "goals": 90,
      "xg": 79.289,
      "factor": 1.10412,
      "team": "UTA"
    },
    "8479344": {
      "shots": 113,
      "goals": 7,
      "xg": 8.019,
      "factor": 0.97546,
      "team": "PIT"
    },
    "8479345": {
      "shots": 989,
      "goals": 60,
      "xg": 55.272,
      "factor": 1.06322,
      "team": "WSH"
    },
    "8479346": {
      "shots": 59,
      "goals": 3,
      "xg": 4.748,
      "factor": 0.96615,
      "team": "CGY"
    },
    "8479348": {
      "shots": 3,
      "goals": 0,
      "xg": 0.137,
      "factor": 0.99972,
      "team": "BUF"
    },
    "8479351": {
      "shots": 373,
      "goals": 27,
      "xg": 29.217,
      "factor": 0.95981,
      "team": "DAL"
    },
    "8479353": {
      "shots": 389,
      "goals": 43,
      "xg": 33.722,
      "factor": 1.15202,
      "team": "VGK"
    },
    "8479356": {
      "shots": 44,
      "goals": 2,
      "xg": 3.14,
      "factor": 0.9799,
      "team": "NSH"
    },
    "8479359": {
      "shots": 354,
      "goals": 17,
      "xg": 27.403,
      "factor": 0.82,
      "team": "BUF"
    },
    "8479362": {
      "shots": 19,
      "goals": 2,
      "xg": 1.398,
      "factor": 1.00612,
      "team": "COL"
    },
    "8479365": {
      "shots": 402,
      "goals": 30,
      "xg": 32.161,
      "factor": 0.96283,
      "team": "BOS"
    },
    "8479367": {
      "shots": 29,
      "goals": 0,
      "xg": 1.938,
      "factor": 0.97295,
      "team": "FLA"
    },
    "8479368": {
      "shots": 167,
      "goals": 9,
      "xg": 13.734,
      "factor": 0.89517,
      "team": "ANA"
    },
    "8479369": {
      "shots": 326,
      "goals": 7,
      "xg": 15.846,
      "factor": 0.82,
      "team": "BOS"
    },
    "8479370": {
      "shots": 261,
      "goals": 15,
      "xg": 20.008,
      "factor": 0.89418,
      "team": "NSH"
    },
    "8479371": {
      "shots": 336,
      "goals": 17,
      "xg": 15.791,
      "factor": 1.0331,
      "team": "CBJ"
    },
    "8479372": {
      "shots": 148,
      "goals": 1,
      "xg": 7.405,
      "factor": 0.82,
      "team": "SEA"
    },
    "8479378": {
      "shots": 298,
      "goals": 11,
      "xg": 14.165,
      "factor": 0.91098,
      "team": "WPG"
    },
    "8479379": {
      "shots": 48,
      "goals": 1,
      "xg": 3.273,
      "factor": 0.95755,
      "team": "SJS"
    },
    "8479383": {
      "shots": 97,
      "goals": 8,
      "xg": 7.121,
      "factor": 1.02035,
      "team": "CHI"
    },
    "8479385": {
      "shots": 957,
      "goals": 88,
      "xg": 71.227,
      "factor": 1.17819,
      "team": "STL"
    },
    "8479387": {
      "shots": 71,
      "goals": 0,
      "xg": 3.131,
      "factor": 0.92043,
      "team": "COL"
    },
    "8479388": {
      "shots": 7,
      "goals": 0,
      "xg": 0.364,
      "factor": 0.99837,
      "team": "CAR"
    },
    "8479390": {
      "shots": 399,
      "goals": 21,
      "xg": 31.976,
      "factor": 0.82,
      "team": "CHI"
    },
    "8479393": {
      "shots": 333,
      "goals": 15,
      "xg": 24.273,
      "factor": 0.82,
      "team": "TOR"
    },
    "8479395": {
      "shots": 61,
      "goals": 3,
      "xg": 2.92,
      "factor": 1.00186,
      "team": "NYI"
    },
    "8479398": {
      "shots": 322,
      "goals": 9,
      "xg": 16.32,
      "factor": 0.82,
      "team": "COL"
    },
    "8479400": {
      "shots": 532,
      "goals": 45,
      "xg": 45.226,
      "factor": 0.99683,
      "team": "WSH"
    },
    "8479402": {
      "shots": 234,
      "goals": 7,
      "xg": 12.077,
      "factor": 0.85708,
      "team": "CGY"
    },
    "8479406": {
      "shots": 2,
      "goals": 1,
      "xg": 0.522,
      "factor": 1.00062,
      "team": "MIN"
    },
    "8479407": {
      "shots": 912,
      "goals": 77,
      "xg": 74.685,
      "factor": 1.02338,
      "team": "NJD"
    },
    "8479410": {
      "shots": 521,
      "goals": 27,
      "xg": 27.523,
      "factor": 0.98906,
      "team": "UTA"
    },
    "8479414": {
      "shots": 178,
      "goals": 15,
      "xg": 15.516,
      "factor": 0.98908,
      "team": "NJD"
    },
    "8479415": {
      "shots": 101,
      "goals": 10,
      "xg": 8.266,
      "factor": 1.03832,
      "team": "NJD"
    },
    "8479419": {
      "shots": 1,
      "goals": 0,
      "xg": 0.1,
      "factor": 0.99993,
      "team": "BUF"
    },
    "8479420": {
      "shots": 1124,
      "goals": 116,
      "xg": 82.279,
      "factor": 1.2,
      "team": "BUF"
    },
    "8479421": {
      "shots": 72,
      "goals": 2,
      "xg": 3.196,
      "factor": 0.96949,
      "team": "LAK"
    },
    "8479423": {
      "shots": 111,
      "goals": 11,
      "xg": 9.223,
      "factor": 1.03936,
      "team": "CBJ"
    },
    "8479425": {
      "shots": 593,
      "goals": 18,
      "xg": 30.243,
      "factor": 0.82,
      "team": "VAN"
    },
    "8479439": {
      "shots": 73,
      "goals": 7,
      "xg": 5.143,
      "factor": 1.04077,
      "team": "SJS"
    },
    "8479442": {
      "shots": 270,
      "goals": 7,
      "xg": 14.381,
      "factor": 0.82,
      "team": "TOR"
    },
    "8479458": {
      "shots": 52,
      "goals": 2,
      "xg": 2.445,
      "factor": 0.99045,
      "team": "CHI"
    },
    "8479465": {
      "shots": 7,
      "goals": 0,
      "xg": 0.442,
      "factor": 0.99804,
      "team": "EDM"
    },
    "8479496": {
      "shots": 1,
      "goals": 0,
      "xg": 0.092,
      "factor": 0.99994,
      "team": "NYI"
    },
    "8479514": {
      "shots": 22,
      "goals": 1,
      "xg": 1.98,
      "factor": 0.9893,
      "team": "CHI"
    },
    "8479520": {
      "shots": 380,
      "goals": 18,
      "xg": 29.59,
      "factor": 0.82,
      "team": "WSH"
    },
    "8479522": {
      "shots": 8,
      "goals": 0,
      "xg": 0.349,
      "factor": 0.99822,
      "team": "WSH"
    },
    "8479523": {
      "shots": 25,
      "goals": 1,
      "xg": 1.398,
      "factor": 0.99484,
      "team": "SJS"
    },
    "8479525": {
      "shots": 682,
      "goals": 42,
      "xg": 56.434,
      "factor": 0.82276,
      "team": "COL"
    },
    "8479533": {
      "shots": 32,
      "goals": 1,
      "xg": 2.283,
      "factor": 0.98117,
      "team": "PIT"
    },
    "8479536": {
      "shots": 40,
      "goals": 2,
      "xg": 2.656,
      "factor": 0.98881,
      "team": "WPG"
    },
    "8479542": {
      "shots": 909,
      "goals": 97,
      "xg": 80.375,
      "factor": 1.15702,
      "team": "TBL"
    },
    "8479543": {
      "shots": 92,
      "goals": 3,
      "xg": 6.06,
      "factor": 0.92639,
      "team": "MTL"
    },
    "8479546": {
      "shots": 41,
      "goals": 1,
      "xg": 2.967,
      "factor": 0.96672,
      "team": "BOS"
    },
    "8479547": {
      "shots": 29,
      "goals": 1,
      "xg": 2.586,
      "factor": 0.97921,
      "team": "WSH"
    },
    "8479550": {
      "shots": 21,
      "goals": 1,
      "xg": 1.818,
      "factor": 0.99129,
      "team": "VGK"
    },
    "8479576": {
      "shots": 173,
      "goals": 2,
      "xg": 7.758,
      "factor": 0.82093,
      "team": "EDM"
    },
    "8479591": {
      "shots": 573,
      "goals": 28,
      "xg": 43.31,
      "factor": 0.82,
      "team": "TBL"
    },
    "8479594": {
      "shots": 4,
      "goals": 0,
      "xg": 0.16,
      "factor": 0.99957,
      "team": "PIT"
    },
    "8479619": {
      "shots": 510,
      "goals": 44,
      "xg": 38.781,
      "factor": 1.08245,
      "team": "UTA"
    },
    "8479638": {
      "shots": 337,
      "goals": 33,
      "xg": 29.9,
      "factor": 1.05331,
      "team": "PIT"
    },
    "8479639": {
      "shots": 27,
      "goals": 0,
      "xg": 1.107,
      "factor": 0.98414,
      "team": "WPG"
    },
    "8479644": {
      "shots": 5,
      "goals": 1,
      "xg": 0.344,
      "factor": 1.00212,
      "team": "STL"
    },
    "8479661": {
      "shots": 310,
      "goals": 20,
      "xg": 25.579,
      "factor": 0.89488,
      "team": "BOS"
    },
    "8479671": {
      "shots": 384,
      "goals": 38,
      "xg": 31.646,
      "factor": 1.10912,
      "team": "CBJ"
    },
    "8479675": {
      "shots": 865,
      "goals": 69,
      "xg": 69.928,
      "factor": 0.99014,
      "team": "LAK"
    },
    "8479705": {
      "shots": 104,
      "goals": 3,
      "xg": 8.473,
      "factor": 0.87834,
      "team": "ANA"
    },
    "8479718": {
      "shots": 72,
      "goals": 6,
      "xg": 5.883,
      "factor": 1.0024,
      "team": "TBL"
    },
    "8479746": {
      "shots": 2,
      "goals": 0,
      "xg": 0.157,
      "factor": 0.99979,
      "team": "COL"
    },
    "8479772": {
      "shots": 70,
      "goals": 4,
      "xg": 4.733,
      "factor": 0.98388,
      "team": "OTT"
    },
    "8479941": {
      "shots": 269,
      "goals": 19,
      "xg": 23.526,
      "factor": 0.91398,
      "team": "CBJ"
    },
    "8479942": {
      "shots": 22,
      "goals": 3,
      "xg": 2.047,
      "factor": 1.01033,
      "team": "DET"
    },
    "8479944": {
      "shots": 170,
      "goals": 7,
      "xg": 13.299,
      "factor": 0.85635,
      "team": "CBJ"
    },
    "8479968": {
      "shots": 153,
      "goals": 8,
      "xg": 11.196,
      "factor": 0.9235,
      "team": "BOS"
    },
    "8479972": {
      "shots": 30,
      "goals": 1,
      "xg": 2.028,
      "factor": 0.98535,
      "team": "MIN"
    },
    "8479976": {
      "shots": 182,
      "goals": 4,
      "xg": 10.144,
      "factor": 0.82975,
      "team": "ARI"
    },
    "8479977": {
      "shots": 190,
      "goals": 26,
      "xg": 16.76,
      "factor": 1.19164,
      "team": "UTA"
    },
    "8479980": {
      "shots": 341,
      "goals": 10,
      "xg": 16.92,
      "factor": 0.82,
      "team": "VGK"
    },
    "8479981": {
      "shots": 117,
      "goals": 6,
      "xg": 8.818,
      "factor": 0.93399,
      "team": "FLA"
    },
    "8479982": {
      "shots": 218,
      "goals": 4,
      "xg": 10.602,
      "factor": 0.82,
      "team": "TOR"
    },
    "8479983": {
      "shots": 433,
      "goals": 15,
      "xg": 21.837,
      "factor": 0.83814,
      "team": "SJS"
    },
    "8479985": {
      "shots": 61,
      "goals": 1,
      "xg": 2.828,
      "factor": 0.95727,
      "team": "SEA"
    },
    "8479987": {
      "shots": 677,
      "goals": 89,
      "xg": 52.704,
      "factor": 1.2,
      "team": "BOS"
    },
    "8479992": {
      "shots": 400,
      "goals": 30,
      "xg": 34.624,
      "factor": 0.92519,
      "team": "DET"
    },
    "8479994": {
      "shots": 53,
      "goals": 1,
      "xg": 4.024,
      "factor": 0.94279,
      "team": "LAK"
    },
    "8479996": {
      "shots": 392,
      "goals": 31,
      "xg": 32.069,
      "factor": 0.98171,
      "team": "NJD"
    },
    "8479998": {
      "shots": 379,
      "goals": 12,
      "xg": 19.95,
      "factor": 0.82,
      "team": "LAK"
    },
    "8479999": {
      "shots": 464,
      "goals": 50,
      "xg": 39.089,
      "factor": 1.16694,
      "team": "BOS"
    },
    "8480001": {
      "shots": 209,
      "goals": 3,
      "xg": 9.651,
      "factor": 0.82,
      "team": "NYR"
    },
    "8480002": {
      "shots": 827,
      "goals": 90,
      "xg": 74.713,
      "factor": 1.15179,
      "team": "NJD"
    },
    "8480003": {
      "shots": 306,
      "goals": 22,
      "xg": 23.835,
      "factor": 0.96371,
      "team": "FLA"
    },
    "8480007": {
      "shots": 55,
      "goals": 1,
      "xg": 4.544,
      "factor": 0.93388,
      "team": "VGK"
    },
    "8480008": {
      "shots": 52,
      "goals": 3,
      "xg": 3.58,
      "factor": 0.98878,
      "team": "CGY"
    },
    "8480009": {
      "shots": 662,
      "goals": 53,
      "xg": 49.124,
      "factor": 1.05334,
      "team": "SEA"
    },
    "8480011": {
      "shots": 109,
      "goals": 9,
      "xg": 8.589,
      "factor": 1.00934,
      "team": "SJS"
    },
    "8480012": {
      "shots": 719,
      "goals": 65,
      "xg": 59.485,
      "factor": 1.06536,
      "team": "VAN"
    },
    "8480014": {
      "shots": 588,
      "goals": 81,
      "xg": 55.241,
      "factor": 1.2,
      "team": "WPG"
    },
    "8480015": {
      "shots": 1037,
      "goals": 79,
      "xg": 77.152,
      "factor": 1.01849,
      "team": "PHI"
    },
    "8480018": {
      "shots": 852,
      "goals": 96,
      "xg": 70.861,
      "factor": 1.2,
      "team": "MTL"
    },
    "8480021": {
      "shots": 57,
      "goals": 1,
      "xg": 3.863,
      "factor": 0.94195,
      "team": "SJS"
    },
    "8480023": {
      "shots": 617,
      "goals": 75,
      "xg": 51.591,
      "factor": 1.2,
      "team": "STL"
    },
    "8480025": {
      "shots": 96,
      "goals": 5,
      "xg": 7.477,
      "factor": 0.94433,
      "team": "CHI"
    },
    "8480027": {
      "shots": 1070,
      "goals": 121,
      "xg": 85.587,
      "factor": 1.2,
      "team": "DAL"
    },
    "8480028": {
      "shots": 616,
      "goals": 55,
      "xg": 50.987,
      "factor": 1.05265,
      "team": "PHI"
    },
    "8480031": {
      "shots": 3,
      "goals": 0,
      "xg": 0.299,
      "factor": 0.99941,
      "team": "CAR"
    },
    "8480032": {
      "shots": 10,
      "goals": 0,
      "xg": 0.691,
      "factor": 0.99581,
      "team": "NJD"
    },
    "8480035": {
      "shots": 289,
      "goals": 8,
      "xg": 13.85,
      "factor": 0.83503,
      "team": "BUF"
    },
    "8480036": {
      "shots": 626,
      "goals": 23,
      "xg": 36.501,
      "factor": 0.82,
      "team": "DAL"
    },
    "8480039": {
      "shots": 937,
      "goals": 94,
      "xg": 70.284,
      "factor": 1.2,
      "team": "CAR"
    },
    "8480043": {
      "shots": 331,
      "goals": 10,
      "xg": 16.821,
      "factor": 0.82199,
      "team": "SJS"
    },
    "8480049": {
      "shots": 382,
      "goals": 8,
      "xg": 18.591,
      "factor": 0.82,
      "team": "WPG"
    },
    "8480058": {
      "shots": 158,
      "goals": 3,
      "xg": 7.822,
      "factor": 0.85754,
      "team": "PIT"
    },
    "8480064": {
      "shots": 405,
      "goals": 53,
      "xg": 34.828,
      "factor": 1.2,
      "team": "OTT"
    },
    "8480068": {
      "shots": 405,
      "goals": 34,
      "xg": 33.592,
      "factor": 1.0068,
      "team": "PHI"
    },
    "8480069": {
      "shots": 1072,
      "goals": 71,
      "xg": 64.387,
      "factor": 1.07822,
      "team": "COL"
    },
    "8480070": {
      "shots": 32,
      "goals": 0,
      "xg": 1.419,
      "factor": 0.97726,
      "team": "BOS"
    },
    "8480073": {
      "shots": 155,
      "goals": 6,
      "xg": 8.662,
      "factor": 0.92608,
      "team": "OTT"
    },
    "8480074": {
      "shots": 345,
      "goals": 30,
      "xg": 24.706,
      "factor": 1.10638,
      "team": "CBJ"
    },
    "8480075": {
      "shots": 10,
      "goals": 0,
      "xg": 0.4,
      "factor": 0.9975,
      "team": "OTT"
    },
    "8480078": {
      "shots": 263,
      "goals": 16,
      "xg": 20.382,
      "factor": 0.90833,
      "team": "NYR"
    },
    "8480084": {
      "shots": 129,
      "goals": 5,
      "xg": 6.326,
      "factor": 0.96136,
      "team": "UTA"
    },
    "8480113": {
      "shots": 519,
      "goals": 39,
      "xg": 44.659,
      "factor": 0.92021,
      "team": "WPG"
    },
    "8480144": {
      "shots": 218,
      "goals": 15,
      "xg": 16.844,
      "factor": 0.95934,
      "team": "TOR"
    },
    "8480145": {
      "shots": 566,
      "goals": 18,
      "xg": 26.861,
      "factor": 0.82,
      "team": "WPG"
    },
    "8480157": {
      "shots": 8,
      "goals": 0,
      "xg": 0.32,
      "factor": 0.99836,
      "team": "STL"
    },
    "8480172": {
      "shots": 186,
      "goals": 8,
      "xg": 9.434,
      "factor": 0.95819,
      "team": "SJS"
    },
    "8480184": {
      "shots": 45,
      "goals": 3,
      "xg": 2.474,
      "factor": 1.01004,
      "team": "ANA"
    },
    "8480185": {
      "shots": 485,
      "goals": 32,
      "xg": 41.818,
      "factor": 0.85627,
      "team": "FLA"
    },
    "8480188": {
      "shots": 810,
      "goals": 62,
      "xg": 59.694,
      "factor": 1.02787,
      "team": "SJS"
    },
    "8480192": {
      "shots": 261,
      "goals": 7,
      "xg": 13.206,
      "factor": 0.8268,
      "team": "NJD"
    },
    "8480196": {
      "shots": 86,
      "goals": 3,
      "xg": 4.132,
      "factor": 0.96983,
      "team": "BUF"
    },
    "8480205": {
      "shots": 142,
      "goals": 8,
      "xg": 10.2,
      "factor": 0.94668,
      "team": "CBJ"
    },
    "8480208": {
      "shots": 867,
      "goals": 90,
      "xg": 71.36,
      "factor": 1.1945,
      "team": "OTT"
    },
    "8480216": {
      "shots": 5,
      "goals": 0,
      "xg": 0.424,
      "factor": 0.99864,
      "team": "SJS"
    },
    "8480220": {
      "shots": 461,
      "goals": 40,
      "xg": 39.403,
      "factor": 1.00906,
      "team": "PHI"
    },
    "8480222": {
      "shots": 77,
      "goals": 2,
      "xg": 3.676,
      "factor": 0.95699,
      "team": "NYI"
    },
    "8480226": {
      "shots": 2,
      "goals": 0,
      "xg": 0.184,
      "factor": 0.99975,
      "team": "SEA"
    },
    "8480245": {
      "shots": 72,
      "goals": 2,
      "xg": 5.955,
      "factor": 0.91902,
      "team": "PHI"
    },
    "8480246": {
      "shots": 318,
      "goals": 11,
      "xg": 17.81,
      "factor": 0.83152,
      "team": "TBL"
    },
    "8480252": {
      "shots": 67,
      "goals": 4,
      "xg": 5.024,
      "factor": 0.97868,
      "team": "CHI"
    },
    "8480259": {
      "shots": 76,
      "goals": 1,
      "xg": 5.246,
      "factor": 0.90484,
      "team": "MIN"
    },
    "8480267": {
      "shots": 4,
      "goals": 0,
      "xg": 0.216,
      "factor": 0.99943,
      "team": "MIN"
    },
    "8480280": {
      "shots": 1,
      "goals": 0,
      "xg": 0.104,
      "factor": 0.99993,
      "team": "BOS"
    },
    "8480281": {
      "shots": 360,
      "goals": 22,
      "xg": 28.942,
      "factor": 0.87473,
      "team": "STL"
    },
    "8480289": {
      "shots": 406,
      "goals": 30,
      "xg": 33.294,
      "factor": 0.94474,
      "team": "WPG"
    },
    "8480291": {
      "shots": 6,
      "goals": 1,
      "xg": 0.514,
      "factor": 1.00184,
      "team": "CAR"
    },
    "8480292": {
      "shots": 15,
      "goals": 1,
      "xg": 1.158,
      "factor": 0.99868,
      "team": "CBJ"
    },
    "8480306": {
      "shots": 16,
      "goals": 0,
      "xg": 0.904,
      "factor": 0.99171,
      "team": "NYI"
    },
    "8480326": {
      "shots": 3,
      "goals": 0,
      "xg": 0.239,
      "factor": 0.99952,
      "team": "DET"
    },
    "8480336": {
      "shots": 691,
      "goals": 24,
      "xg": 36.912,
      "factor": 0.82,
      "team": "CAR"
    },
    "8480355": {
      "shots": 343,
      "goals": 22,
      "xg": 27.14,
      "factor": 0.90406,
      "team": "BOS"
    },
    "8480426": {
      "shots": 126,
      "goals": 6,
      "xg": 6.782,
      "factor": 0.97823,
      "team": "TBL"
    },
    "8480434": {
      "shots": 413,
      "goals": 18,
      "xg": 23.207,
      "factor": 0.8838,
      "team": "UTA"
    },
    "8480441": {
      "shots": 28,
      "goals": 2,
      "xg": 1.857,
      "factor": 1.00196,
      "team": "CBJ"
    },
    "8480448": {
      "shots": 438,
      "goals": 37,
      "xg": 32.593,
      "factor": 1.07695,
      "team": "COL"
    },
    "8480459": {
      "shots": 487,
      "goals": 52,
      "xg": 43.058,
      "factor": 1.12787,
      "team": "VAN"
    },
    "8480468": {
      "shots": 27,
      "goals": 2,
      "xg": 2.257,
      "factor": 0.99674,
      "team": "EDM"
    },
    "8480727": {
      "shots": 297,
      "goals": 8,
      "xg": 15.13,
      "factor": 0.82,
      "team": "VGK"
    },
    "8480748": {
      "shots": 662,
      "goals": 52,
      "xg": 47.132,
      "factor": 1.06942,
      "team": "VAN"
    },
    "8480762": {
      "shots": 400,
      "goals": 29,
      "xg": 33.497,
      "factor": 0.92526,
      "team": "CAR"
    },
    "8480776": {
      "shots": 20,
      "goals": 2,
      "xg": 1.592,
      "factor": 1.00426,
      "team": "VGK"
    },
    "8480789": {
      "shots": 131,
      "goals": 7,
      "xg": 9.54,
      "factor": 0.93901,
      "team": "NYI"
    },
    "8480796": {
      "shots": 312,
      "goals": 13,
      "xg": 16.054,
      "factor": 0.91947,
      "team": "WSH"
    },
    "8480797": {
      "shots": 649,
      "goals": 54,
      "xg": 51.664,
      "factor": 1.03065,
      "team": "PHI"
    },
    "8480798": {
      "shots": 367,
      "goals": 33,
      "xg": 28.348,
      "factor": 1.08587,
      "team": "CHI"
    },
    "8480800": {
      "shots": 888,
      "goals": 40,
      "xg": 49.616,
      "factor": 0.86123,
      "team": "VAN"
    },
    "8480801": {
      "shots": 1214,
      "goals": 89,
      "xg": 98.905,
      "factor": 0.91931,
      "team": "OTT"
    },
    "8480802": {
      "shots": 452,
      "goals": 46,
      "xg": 39.498,
      "factor": 1.09789,
      "team": "BUF"
    },
    "8480803": {
      "shots": 941,
      "goals": 53,
      "xg": 49.581,
      "factor": 1.04984,
      "team": "EDM"
    },
    "8480806": {
      "shots": 226,
      "goals": 13,
      "xg": 19.401,
      "factor": 0.86996,
      "team": "ANA"
    },
    "8480807": {
      "shots": 302,
      "goals": 18,
      "xg": 16.633,
      "factor": 1.03478,
      "team": "BUF"
    },
    "8480813": {
      "shots": 318,
      "goals": 22,
      "xg": 25.232,
      "factor": 0.93789,
      "team": "DET"
    },
    "8480817": {
      "shots": 517,
      "goals": 23,
      "xg": 27.87,
      "factor": 0.89929,
      "team": "NYR"
    },
    "8480821": {
      "shots": 198,
      "goals": 13,
      "xg": 15.413,
      "factor": 0.94602,
      "team": "SJS"
    },
    "8480823": {
      "shots": 42,
      "goals": 1,
      "xg": 1.775,
      "factor": 0.98501,
      "team": "WSH"
    },
    "8480825": {
      "shots": 22,
      "goals": 1,
      "xg": 1.74,
      "factor": 0.99173,
      "team": "SJS"
    },
    "8480828": {
      "shots": 19,
      "goals": 1,
      "xg": 0.811,
      "factor": 1.00205,
      "team": "BOS"
    },
    "8480829": {
      "shots": 412,
      "goals": 26,
      "xg": 32.401,
      "factor": 0.88973,
      "team": "CAR"
    },
    "8480830": {
      "shots": 835,
      "goals": 74,
      "xg": 68.334,
      "factor": 1.06106,
      "team": "CAR"
    },
    "8480831": {
      "shots": 32,
      "goals": 0,
      "xg": 1.608,
      "factor": 0.97473,
      "team": "EDM"
    },
    "8480834": {
      "shots": 200,
      "goals": 5,
      "xg": 9.261,
      "factor": 0.87008,
      "team": "EDM"
    },
    "8480835": {
      "shots": 468,
      "goals": 26,
      "xg": 36.498,
      "factor": 0.82962,
      "team": "CAR"
    },
    "8480836": {
      "shots": 12,
      "goals": 1,
      "xg": 0.982,
      "factor": 1.00013,
      "team": "PIT"
    },
    "8480839": {
      "shots": 888,
      "goals": 56,
      "xg": 52.712,
      "factor": 1.04502,
      "team": "BUF"
    },
    "8480840": {
      "shots": 140,
      "goals": 9,
      "xg": 12.2,
      "factor": 0.93069,
      "team": "DAL"
    },
    "8480842": {
      "shots": 34,
      "goals": 1,
      "xg": 2.886,
      "factor": 0.97248,
      "team": "PIT"
    },
    "8480843": {
      "shots": 3,
      "goals": 0,
      "xg": 0.959,
      "factor": 0.99825,
      "team": "ANA"
    },
    "8480844": {
      "shots": 8,
      "goals": 0,
      "xg": 0.651,
      "factor": 0.9968,
      "team": "VGK"
    },
    "8480845": {
      "shots": 114,
      "goals": 5,
      "xg": 8.69,
      "factor": 0.91427,
      "team": "WPG"
    },
    "8480848": {
      "shots": 237,
      "goals": 5,
      "xg": 18.599,
      "factor": 0.82,
      "team": "SJS"
    },
    "8480849": {
      "shots": 510,
      "goals": 33,
      "xg": 45.272,
      "factor": 0.82973,
      "team": "UTA"
    },
    "8480851": {
      "shots": 39,
      "goals": 4,
      "xg": 2.637,
      "factor": 1.02283,
      "team": "LAK"
    },
    "8480853": {
      "shots": 16,
      "goals": 0,
      "xg": 1.361,
      "factor": 0.98813,
      "team": "NSH"
    },
    "8480855": {
      "shots": 401,
      "goals": 30,
      "xg": 34.698,
      "factor": 0.92406,
      "team": "UTA"
    },
    "8480860": {
      "shots": 316,
      "goals": 8,
      "xg": 15.676,
      "factor": 0.82,
      "team": "CGY"
    },
    "8480865": {
      "shots": 799,
      "goals": 33,
      "xg": 41.309,
      "factor": 0.86247,
      "team": "NYI"
    },
    "8480870": {
      "shots": 76,
      "goals": 3,
      "xg": 5.726,
      "factor": 0.94104,
      "team": "ANA"
    },
    "8480871": {
      "shots": 158,
      "goals": 5,
      "xg": 9.016,
      "factor": 0.88968,
      "team": "CBJ"
    },
    "8480873": {
      "shots": 386,
      "goals": 12,
      "xg": 20.896,
      "factor": 0.82,
      "team": "WSH"
    },
    "8480874": {
      "shots": 13,
      "goals": 1,
      "xg": 0.582,
      "factor": 1.00328,
      "team": "PHI"
    },
    "8480876": {
      "shots": 50,
      "goals": 1,
      "xg": 4.067,
      "factor": 0.94475,
      "team": "TBL"
    },
    "8480878": {
      "shots": 258,
      "goals": 5,
      "xg": 11.98,
      "factor": 0.82,
      "team": "DAL"
    },
    "8480879": {
      "shots": 197,
      "goals": 7,
      "xg": 8.803,
      "factor": 0.94393,
      "team": "OTT"
    },
    "8480880": {
      "shots": 136,
      "goals": 7,
      "xg": 10.366,
      "factor": 0.92113,
      "team": "BOS"
    },
    "8480883": {
      "shots": 19,
      "goals": 1,
      "xg": 0.842,
      "factor": 1.0017,
      "team": "CAR"
    },
    "8480884": {
      "shots": 127,
      "goals": 1,
      "xg": 6.664,
      "factor": 0.84021,
      "team": "SJS"
    },
    "8480887": {
      "shots": 106,
      "goals": 5,
      "xg": 4.951,
      "factor": 1.00141,
      "team": "MTL"
    },
    "8480890": {
      "shots": 4,
      "goals": 0,
      "xg": 0.204,
      "factor": 0.99946,
      "team": "ARI"
    },
    "8480891": {
      "shots": 433,
      "goals": 12,
      "xg": 22.116,
      "factor": 0.82,
      "team": "UTA"
    },
    "8480893": {
      "shots": 911,
      "goals": 90,
      "xg": 69.922,
      "factor": 1.2,
      "team": "CBJ"
    },
    "8480950": {
      "shots": 215,
      "goals": 2,
      "xg": 10.751,
      "factor": 0.82,
      "team": "DAL"
    },
    "8480980": {
      "shots": 369,
      "goals": 29,
      "xg": 29.478,
      "factor": 0.99142,
      "team": "PIT"
    },
    "8480981": {
      "shots": 7,
      "goals": 0,
      "xg": 2.595,
      "factor": 0.99083,
      "team": "STL"
    },
    "8480990": {
      "shots": 169,
      "goals": 6,
      "xg": 8.277,
      "factor": 0.93226,
      "team": "MIN"
    },
    "8480995": {
      "shots": 338,
      "goals": 25,
      "xg": 29.813,
      "factor": 0.91694,
      "team": "TOR"
    },
    "8481004": {
      "shots": 3,
      "goals": 0,
      "xg": 0.212,
      "factor": 0.99958,
      "team": "CAR"
    },
    "8481006": {
      "shots": 169,
      "goals": 7,
      "xg": 8.11,
      "factor": 0.96663,
      "team": "STL"
    },
    "8481013": {
      "shots": 252,
      "goals": 22,
      "xg": 19.5,
      "factor": 1.05303,
      "team": "DET"
    },
    "8481014": {
      "shots": 335,
      "goals": 11,
      "xg": 15.794,
      "factor": 0.86895,
      "team": "NYI"
    },
    "8481016": {
      "shots": 2,
      "goals": 0,
      "xg": 0.152,
      "factor": 0.99979,
      "team": "NYI"
    },
    "8481019": {
      "shots": 86,
      "goals": 5,
      "xg": 6.352,
      "factor": 0.96954,
      "team": "WPG"
    },
    "8481024": {
      "shots": 232,
      "goals": 19,
      "xg": 20.392,
      "factor": 0.9724,
      "team": "VAN"
    },
    "8481028": {
      "shots": 363,
      "goals": 13,
      "xg": 26.917,
      "factor": 0.82,
      "team": "CGY"
    },
    "8481030": {
      "shots": 70,
      "goals": 0,
      "xg": 3.291,
      "factor": 0.91838,
      "team": "PIT"
    },
    "8481032": {
      "shots": 416,
      "goals": 37,
      "xg": 34.044,
      "factor": 1.04908,
      "team": "NJD"
    },
    "8481042": {
      "shots": 77,
      "goals": 7,
      "xg": 6.19,
      "factor": 1.01711,
      "team": "COL"
    },
    "8481043": {
      "shots": 270,
      "goals": 18,
      "xg": 21.187,
      "factor": 0.93448,
      "team": "BOS"
    },
    "8481056": {
      "shots": 127,
      "goals": 4,
      "xg": 6.595,
      "factor": 0.92645,
      "team": "NSH"
    },
    "8481058": {
      "shots": 73,
      "goals": 6,
      "xg": 5.248,
      "factor": 1.01639,
      "team": "MTL"
    },
    "8481059": {
      "shots": 81,
      "goals": 2,
      "xg": 3.897,
      "factor": 0.95052,
      "team": "STL"
    },
    "8481065": {
      "shots": 44,
      "goals": 3,
      "xg": 3.16,
      "factor": 0.99719,
      "team": "OTT"
    },
    "8481068": {
      "shots": 709,
      "goals": 68,
      "xg": 55.316,
      "factor": 1.15977,
      "team": "CGY"
    },
    "8481070": {
      "shots": 8,
      "goals": 1,
      "xg": 0.698,
      "factor": 1.00148,
      "team": "STL"
    },
    "8481077": {
      "shots": 30,
      "goals": 3,
      "xg": 2.09,
      "factor": 1.01289,
      "team": "DET"
    },
    "8481093": {
      "shots": 48,
      "goals": 2,
      "xg": 4.378,
      "factor": 0.95955,
      "team": "MTL"
    },
    "8481122": {
      "shots": 244,
      "goals": 2,
      "xg": 12.881,
      "factor": 0.82,
      "team": "TOR"
    },
    "8481133": {
      "shots": 95,
      "goals": 10,
      "xg": 7.241,
      "factor": 1.06253,
      "team": "VGK"
    },
    "8481147": {
      "shots": 69,
      "goals": 2,
      "xg": 4.957,
      "factor": 0.93677,
      "team": "CHI"
    },
    "8481161": {
      "shots": 147,
      "goals": 1,
      "xg": 6.632,
      "factor": 0.82696,
      "team": "CBJ"
    },
    "8481167": {
      "shots": 223,
      "goals": 6,
      "xg": 10.976,
      "factor": 0.85491,
      "team": "CGY"
    },
    "8481178": {
      "shots": 176,
      "goals": 8,
      "xg": 8.139,
      "factor": 0.99575,
      "team": "PHI"
    },
    "8481186": {
      "shots": 285,
      "goals": 23,
      "xg": 23.529,
      "factor": 0.98971,
      "team": "COL"
    },
    "8481206": {
      "shots": 47,
      "goals": 3,
      "xg": 2.33,
      "factor": 1.01342,
      "team": "PIT"
    },
    "8481219": {
      "shots": 89,
      "goals": 3,
      "xg": 4.106,
      "factor": 0.96978,
      "team": "BOS"
    },
    "8481237": {
      "shots": 208,
      "goals": 10,
      "xg": 15.622,
      "factor": 0.87241,
      "team": "NYI"
    },
    "8481239": {
      "shots": 15,
      "goals": 1,
      "xg": 1.017,
      "factor": 0.99986,
      "team": "LAK"
    },
    "8481422": {
      "shots": 40,
      "goals": 2,
      "xg": 2.718,
      "factor": 0.98782,
      "team": "MIN"
    },
    "8481461": {
      "shots": 6,
      "goals": 0,
      "xg": 0.274,
      "factor": 0.99893,
      "team": "STL"
    },
    "8481462": {
      "shots": 12,
      "goals": 3,
      "xg": 1.103,
      "factor": 1.01303,
      "team": "VGK"
    },
    "8481477": {
      "shots": 253,
      "goals": 17,
      "xg": 21.091,
      "factor": 0.91782,
      "team": "SJS"
    },
    "8481481": {
      "shots": 258,
      "goals": 25,
      "xg": 20.786,
      "factor": 1.08624,
      "team": "PIT"
    },
    "8481486": {
      "shots": 6,
      "goals": 0,
      "xg": 0.257,
      "factor": 0.999,
      "team": "SJS"
    },
    "8481491": {
      "shots": 43,
      "goals": 2,
      "xg": 3.292,
      "factor": 0.97793,
      "team": "EDM"
    },
    "8481517": {
      "shots": 253,
      "goals": 16,
      "xg": 17.976,
      "factor": 0.95555,
      "team": "ANA"
    },
    "8481518": {
      "shots": 43,
      "goals": 2,
      "xg": 2.954,
      "factor": 0.9832,
      "team": "FLA"
    },
    "8481519": {
      "shots": 1,
      "goals": 0,
      "xg": 0.112,
      "factor": 0.99992,
      "team": "CHI"
    },
    "8481521": {
      "shots": 28,
      "goals": 0,
      "xg": 1.582,
      "factor": 0.97777,
      "team": "PHI"
    },
    "8481522": {
      "shots": 395,
      "goals": 26,
      "xg": 30.383,
      "factor": 0.92156,
      "team": "BUF"
    },
    "8481523": {
      "shots": 207,
      "goals": 19,
      "xg": 17.025,
      "factor": 1.04222,
      "team": "MTL"
    },
    "8481524": {
      "shots": 464,
      "goals": 30,
      "xg": 29.514,
      "factor": 1.00934,
      "team": "BUF"
    },
    "8481525": {
      "shots": 132,
      "goals": 6,
      "xg": 6.499,
      "factor": 0.98544,
      "team": "NYR"
    },
    "8481527": {
      "shots": 186,
      "goals": 4,
      "xg": 9.677,
      "factor": 0.83679,
      "team": "VGK"
    },
    "8481528": {
      "shots": 809,
      "goals": 62,
      "xg": 65.597,
      "factor": 0.96002,
      "team": "BUF"
    },
    "8481532": {
      "shots": 256,
      "goals": 13,
      "xg": 21.997,
      "factor": 0.82389,
      "team": "LAK"
    },
    "8481533": {
      "shots": 541,
      "goals": 53,
      "xg": 43.407,
      "factor": 1.14002,
      "team": "PHI"
    },
    "8481534": {
      "shots": 24,
      "goals": 0,
      "xg": 1.807,
      "factor": 0.97832,
      "team": "VGK"
    },
    "8481535": {
      "shots": 354,
      "goals": 34,
      "xg": 30.196,
      "factor": 1.06603,
      "team": "VAN"
    },
    "8481537": {
      "shots": 88,
      "goals": 1,
      "xg": 4.625,
      "factor": 0.90572,
      "team": "SJS"
    },
    "8481540": {
      "shots": 1201,
      "goals": 129,
      "xg": 99.785,
      "factor": 1.2,
      "team": "MTL"
    },
    "8481541": {
      "shots": 54,
      "goals": 2,
      "xg": 2.376,
      "factor": 0.99164,
      "team": "NYI"
    },
    "8481542": {
      "shots": 733,
      "goals": 27,
      "xg": 38.242,
      "factor": 0.82,
      "team": "DET"
    },
    "8481543": {
      "shots": 19,
      "goals": 0,
      "xg": 1.353,
      "factor": 0.98619,
      "team": "STL"
    },
    "8481546": {
      "shots": 449,
      "goals": 18,
      "xg": 27.383,
      "factor": 0.82,
      "team": "PHI"
    },
    "8481547": {
      "shots": 1,
      "goals": 0,
      "xg": 0.04,
      "factor": 0.99997,
      "team": "TBL"
    },
    "8481550": {
      "shots": 17,
      "goals": 0,
      "xg": 1.173,
      "factor": 0.98896,
      "team": "MIN"
    },
    "8481553": {
      "shots": 444,
      "goals": 41,
      "xg": 36.968,
      "factor": 1.0638,
      "team": "PHI"
    },
    "8481554": {
      "shots": 430,
      "goals": 41,
      "xg": 34.201,
      "factor": 1.11356,
      "team": "SEA"
    },
    "8481556": {
      "shots": 180,
      "goals": 13,
      "xg": 14.551,
      "factor": 0.9656,
      "team": "BOS"
    },
    "8481557": {
      "shots": 1191,
      "goals": 109,
      "xg": 95.174,
      "factor": 1.11642,
      "team": "MIN"
    },
    "8481558": {
      "shots": 1,
      "goals": 1,
      "xg": 0.1,
      "factor": 1.00061,
      "team": "BOS"
    },
    "8481559": {
      "shots": 996,
      "goals": 82,
      "xg": 81.979,
      "factor": 1.0002,
      "team": "NJD"
    },
    "8481560": {
      "shots": 188,
      "goals": 11,
      "xg": 13.376,
      "factor": 0.94321,
      "team": "LAK"
    },
    "8481562": {
      "shots": 9,
      "goals": 0,
      "xg": 0.419,
      "factor": 0.99763,
      "team": "CAR"
    },
    "8481563": {
      "shots": 157,
      "goals": 6,
      "xg": 7.838,
      "factor": 0.94592,
      "team": "ANA"
    },
    "8481564": {
      "shots": 67,
      "goals": 0,
      "xg": 3.338,
      "factor": 0.92014,
      "team": "BUF"
    },
    "8481567": {
      "shots": 151,
      "goals": 5,
      "xg": 7.383,
      "factor": 0.92933,
      "team": "SJS"
    },
    "8481568": {
      "shots": 384,
      "goals": 8,
      "xg": 19.418,
      "factor": 0.82,
      "team": "CHI"
    },
    "8481569": {
      "shots": 14,
      "goals": 0,
      "xg": 0.643,
      "factor": 0.99463,
      "team": "NYI"
    },
    "8481572": {
      "shots": 38,
      "goals": 0,
      "xg": 1.837,
      "factor": 0.96745,
      "team": "WPG"
    },
    "8481575": {
      "shots": 19,
      "goals": 0,
      "xg": 0.946,
      "factor": 0.9899,
      "team": "OTT"
    },
    "8481576": {
      "shots": 1,
      "goals": 0,
      "xg": 0.04,
      "factor": 0.99997,
      "team": "CAR"
    },
    "8481577": {
      "shots": 243,
      "goals": 18,
      "xg": 20.059,
      "factor": 0.95785,
      "team": "PIT"
    },
    "8481578": {
      "shots": 4,
      "goals": 0,
      "xg": 0.279,
      "factor": 0.99927,
      "team": "NJD"
    },
    "8481580": {
      "shots": 663,
      "goals": 58,
      "xg": 57.429,
      "factor": 1.00686,
      "team": "WSH"
    },
    "8481581": {
      "shots": 632,
      "goals": 37,
      "xg": 34.651,
      "factor": 1.04286,
      "team": "DAL"
    },
    "8481582": {
      "shots": 494,
      "goals": 45,
      "xg": 36.366,
      "factor": 1.14264,
      "team": "TOR"
    },
    "8481585": {
      "shots": 6,
      "goals": 0,
      "xg": 0.408,
      "factor": 0.99844,
      "team": "NSH"
    },
    "8481591": {
      "shots": 17,
      "goals": 0,
      "xg": 1.036,
      "factor": 0.9901,
      "team": "PIT"
    },
    "8481592": {
      "shots": 90,
      "goals": 8,
      "xg": 6.756,
      "factor": 1.02809,
      "team": "CGY"
    },
    "8481593": {
      "shots": 186,
      "goals": 7,
      "xg": 9.361,
      "factor": 0.9309,
      "team": "MTL"
    },
    "8481594": {
      "shots": 3,
      "goals": 0,
      "xg": 0.292,
      "factor": 0.99942,
      "team": "NJD"
    },
    "8481596": {
      "shots": 620,
      "goals": 55,
      "xg": 54.967,
      "factor": 1.00041,
      "team": "OTT"
    },
    "8481598": {
      "shots": 321,
      "goals": 14,
      "xg": 18.339,
      "factor": 0.89445,
      "team": "STL"
    },
    "8481599": {
      "shots": 12,
      "goals": 0,
      "xg": 0.48,
      "factor": 0.99647,
      "team": "BOS"
    },
    "8481600": {
      "shots": 36,
      "goals": 2,
      "xg": 2.233,
      "factor": 0.99621,
      "team": "FLA"
    },
    "8481601": {
      "shots": 461,
      "goals": 58,
      "xg": 39.137,
      "factor": 1.2,
      "team": "NYI"
    },
    "8481604": {
      "shots": 844,
      "goals": 87,
      "xg": 68.944,
      "factor": 1.19342,
      "team": "VGK"
    },
    "8481605": {
      "shots": 507,
      "goals": 26,
      "xg": 31.681,
      "factor": 0.89434,
      "team": "ANA"
    },
    "8481606": {
      "shots": 451,
      "goals": 13,
      "xg": 22.618,
      "factor": 0.82,
      "team": "LAK"
    },
    "8481607": {
      "shots": 173,
      "goals": 6,
      "xg": 8.681,
      "factor": 0.92124,
      "team": "DET"
    },
    "8481609": {
      "shots": 58,
      "goals": 4,
      "xg": 2.981,
      "factor": 1.02263,
      "team": "UTA"
    },
    "8481611": {
      "shots": 1,
      "goals": 0,
      "xg": 0.1,
      "factor": 0.99993,
      "team": "CAR"
    },
    "8481617": {
      "shots": 387,
      "goals": 27,
      "xg": 31.95,
      "factor": 0.91543,
      "team": "EDM"
    },
    "8481618": {
      "shots": 418,
      "goals": 43,
      "xg": 34.704,
      "factor": 1.1358,
      "team": "MTL"
    },
    "8481624": {
      "shots": 560,
      "goals": 49,
      "xg": 45.485,
      "factor": 1.04974,
      "team": "CHI"
    },
    "8481641": {
      "shots": 252,
      "goals": 22,
      "xg": 21.217,
      "factor": 1.01564,
      "team": "COL"
    },
    "8481655": {
      "shots": 95,
      "goals": 6,
      "xg": 7.764,
      "factor": 0.96134,
      "team": "VGK"
    },
    "8481656": {
      "shots": 654,
      "goals": 61,
      "xg": 54.211,
      "factor": 1.08558,
      "team": "WSH"
    },
    "8481679": {
      "shots": 8,
      "goals": 0,
      "xg": 0.397,
      "factor": 0.99799,
      "team": "OTT"
    },
    "8481690": {
      "shots": 1,
      "goals": 0,
      "xg": 0.04,
      "factor": 0.99997,
      "team": "CBJ"
    },
    "8481692": {
      "shots": 1,
      "goals": 0,
      "xg": 0.408,
      "factor": 0.99973,
      "team": "CGY"
    },
    "8481701": {
      "shots": 18,
      "goals": 0,
      "xg": 0.95,
      "factor": 0.99035,
      "team": "NJD"
    },
    "8481703": {
      "shots": 125,
      "goals": 7,
      "xg": 9.389,
      "factor": 0.9437,
      "team": "PIT"
    },
    "8481704": {
      "shots": 141,
      "goals": 16,
      "xg": 12.423,
      "factor": 1.07693,
      "team": "NSH"
    },
    "8481708": {
      "shots": 138,
      "goals": 3,
      "xg": 8.178,
      "factor": 0.8611,
      "team": "NYR"
    },
    "8481711": {
      "shots": 487,
      "goals": 39,
      "xg": 37.265,
      "factor": 1.02799,
      "team": "ARI"
    },
    "8481712": {
      "shots": 18,
      "goals": 1,
      "xg": 1.486,
      "factor": 0.99534,
      "team": "DAL"
    },
    "8481716": {
      "shots": 601,
      "goals": 58,
      "xg": 53.149,
      "factor": 1.06105,
      "team": "CBJ"
    },
    "8481719": {
      "shots": 95,
      "goals": 1,
      "xg": 4.74,
      "factor": 0.89859,
      "team": "TBL"
    },
    "8481721": {
      "shots": 215,
      "goals": 13,
      "xg": 15.215,
      "factor": 0.94806,
      "team": "NJD"
    },
    "8481725": {
      "shots": 173,
      "goals": 11,
      "xg": 13.599,
      "factor": 0.94102,
      "team": "DET"
    },
    "8481726": {
      "shots": 111,
      "goals": 10,
      "xg": 9.882,
      "factor": 1.00252,
      "team": "NYR"
    },
    "8481732": {
      "shots": 33,
      "goals": 2,
      "xg": 2.663,
      "factor": 0.99037,
      "team": "LAK"
    },
    "8481737": {
      "shots": 6,
      "goals": 0,
      "xg": 0.496,
      "factor": 0.99812,
      "team": "COL"
    },
    "8481743": {
      "shots": 116,
      "goals": 2,
      "xg": 6.528,
      "factor": 0.87785,
      "team": "NSH"
    },
    "8481751": {
      "shots": 8,
      "goals": 0,
      "xg": 0.576,
      "factor": 0.99714,
      "team": "BUF"
    },
    "8481754": {
      "shots": 88,
      "goals": 6,
      "xg": 6.642,
      "factor": 0.98559,
      "team": "ANA"
    },
    "8481789": {
      "shots": 341,
      "goals": 25,
      "xg": 25.241,
      "factor": 0.99525,
      "team": "SEA"
    },
    "8481806": {
      "shots": 244,
      "goals": 11,
      "xg": 12.372,
      "factor": 0.96125,
      "team": "CHI"
    },
    "8481812": {
      "shots": 9,
      "goals": 0,
      "xg": 0.409,
      "factor": 0.99768,
      "team": "SJS"
    },
    "8481848": {
      "shots": 9,
      "goals": 0,
      "xg": 0.654,
      "factor": 0.9964,
      "team": "PHI"
    },
    "8482055": {
      "shots": 625,
      "goals": 43,
      "xg": 53.599,
      "factor": 0.86641,
      "team": "PIT"
    },
    "8482061": {
      "shots": 3,
      "goals": 2,
      "xg": 0.569,
      "factor": 1.00274,
      "team": "BUF"
    },
    "8482062": {
      "shots": 363,
      "goals": 21,
      "xg": 32.076,
      "factor": 0.82,
      "team": "NSH"
    },
    "8482067": {
      "shots": 7,
      "goals": 0,
      "xg": 0.297,
      "factor": 0.99866,
      "team": "NYR"
    },
    "8482070": {
      "shots": 149,
      "goals": 16,
      "xg": 12.6,
      "factor": 1.07474,
      "team": "TBL"
    },
    "8482072": {
      "shots": 12,
      "goals": 0,
      "xg": 0.688,
      "factor": 0.99505,
      "team": "COL"
    },
    "8482073": {
      "shots": 428,
      "goals": 13,
      "xg": 21.959,
      "factor": 0.82,
      "team": "NYR"
    },
    "8482074": {
      "shots": 441,
      "goals": 39,
      "xg": 36.776,
      "factor": 1.03527,
      "team": "CGY"
    },
    "8482077": {
      "shots": 539,
      "goals": 54,
      "xg": 41.348,
      "factor": 1.19219,
      "team": "STL"
    },
    "8482078": {
      "shots": 793,
      "goals": 89,
      "xg": 62.653,
      "factor": 1.2,
      "team": "DET"
    },
    "8482079": {
      "shots": 553,
      "goals": 58,
      "xg": 46.496,
      "factor": 1.15927,
      "team": "MIN"
    },
    "8482087": {
      "shots": 315,
      "goals": 14,
      "xg": 16.223,
      "factor": 0.9416,
      "team": "MTL"
    },
    "8482088": {
      "shots": 179,
      "goals": 16,
      "xg": 14.363,
      "factor": 1.0365,
      "team": "WSH"
    },
    "8482089": {
      "shots": 497,
      "goals": 70,
      "xg": 43.785,
      "factor": 1.2,
      "team": "STL"
    },
    "8482090": {
      "shots": 38,
      "goals": 2,
      "xg": 3.318,
      "factor": 0.9797,
      "team": "STL"
    },
    "8482092": {
      "shots": 522,
      "goals": 39,
      "xg": 45.312,
      "factor": 0.91196,
      "team": "OTT"
    },
    "8482093": {
      "shots": 910,
      "goals": 99,
      "xg": 82.479,
      "factor": 1.15244,
      "team": "CAR"
    },
    "8482094": {
      "shots": 43,
      "goals": 0,
      "xg": 2.269,
      "factor": 0.95739,
      "team": "MIN"
    },
    "8482095": {
      "shots": 257,
      "goals": 7,
      "xg": 12.775,
      "factor": 0.83652,
      "team": "OTT"
    },
    "8482097": {
      "shots": 595,
      "goals": 51,
      "xg": 46.504,
      "factor": 1.06333,
      "team": "BUF"
    },
    "8482100": {
      "shots": 196,
      "goals": 11,
      "xg": 10.096,
      "factor": 1.02605,
      "team": "CAR"
    },
    "8482101": {
      "shots": 37,
      "goals": 1,
      "xg": 2.762,
      "factor": 0.97209,
      "team": "SJS"
    },
    "8482102": {
      "shots": 11,
      "goals": 1,
      "xg": 0.665,
      "factor": 1.00222,
      "team": "PIT"
    },
    "8482103": {
      "shots": 47,
      "goals": 2,
      "xg": 3.586,
      "factor": 0.97166,
      "team": "NSH"
    },
    "8482105": {
      "shots": 751,
      "goals": 35,
      "xg": 42.243,
      "factor": 0.88372,
      "team": "OTT"
    },
    "8482107": {
      "shots": 28,
      "goals": 2,
      "xg": 1.569,
      "factor": 1.00607,
      "team": "FLA"
    },
    "8482109": {
      "shots": 822,
      "goals": 70,
      "xg": 66.517,
      "factor": 1.03835,
      "team": "NYR"
    },
    "8482110": {
      "shots": 636,
      "goals": 59,
      "xg": 56.091,
      "factor": 1.03537,
      "team": "NJD"
    },
    "8482111": {
      "shots": 249,
      "goals": 13,
      "xg": 14.726,
      "factor": 0.95592,
      "team": "NSH"
    },
    "8482113": {
      "shots": 693,
      "goals": 55,
      "xg": 55.31,
      "factor": 0.99611,
      "team": "FLA"
    },
    "8482116": {
      "shots": 787,
      "goals": 81,
      "xg": 68.419,
      "factor": 1.13398,
      "team": "OTT"
    },
    "8482117": {
      "shots": 240,
      "goals": 16,
      "xg": 18.926,
      "factor": 0.93791,
      "team": "CHI"
    },
    "8482118": {
      "shots": 86,
      "goals": 12,
      "xg": 6.945,
      "factor": 1.10936,
      "team": "ANA"
    },
    "8482122": {
      "shots": 629,
      "goals": 33,
      "xg": 33.167,
      "factor": 0.99685,
      "team": "MIN"
    },
    "8482124": {
      "shots": 800,
      "goals": 67,
      "xg": 65.683,
      "factor": 1.01459,
      "team": "LAK"
    },
    "8482125": {
      "shots": 345,
      "goals": 23,
      "xg": 25.617,
      "factor": 0.94884,
      "team": "NJD"
    },
    "8482126": {
      "shots": 141,
      "goals": 3,
      "xg": 7.588,
      "factor": 0.87072,
      "team": "PHI"
    },
    "8482131": {
      "shots": 63,
      "goals": 0,
      "xg": 2.899,
      "factor": 0.93104,
      "team": "FLA"
    },
    "8482132": {
      "shots": 100,
      "goals": 6,
      "xg": 7.446,
      "factor": 0.96657,
      "team": "NYR"
    },
    "8482133": {
      "shots": 75,
      "goals": 6,
      "xg": 5.993,
      "factor": 1.00014,
      "team": "SJS"
    },
    "8482141": {
      "shots": 4,
      "goals": 0,
      "xg": 0.277,
      "factor": 0.99927,
      "team": "VGK"
    },
    "8482142": {
      "shots": 356,
      "goals": 18,
      "xg": 18.662,
      "factor": 0.98352,
      "team": "PHI"
    },
    "8482144": {
      "shots": 66,
      "goals": 4,
      "xg": 3.08,
      "factor": 1.02229,
      "team": "SJS"
    },
    "8482145": {
      "shots": 328,
      "goals": 31,
      "xg": 27.004,
      "factor": 1.07371,
      "team": "DAL"
    },
    "8482146": {
      "shots": 656,
      "goals": 39,
      "xg": 51.752,
      "factor": 0.83254,
      "team": "NSH"
    },
    "8482147": {
      "shots": 2,
      "goals": 1,
      "xg": 0.192,
      "factor": 1.00108,
      "team": "COL"
    },
    "8482148": {
      "shots": 191,
      "goals": 12,
      "xg": 15.198,
      "factor": 0.92903,
      "team": "WSH"
    },
    "8482149": {
      "shots": 631,
      "goals": 50,
      "xg": 51.863,
      "factor": 0.97579,
      "team": "WPG"
    },
    "8482153": {
      "shots": 50,
      "goals": 2,
      "xg": 3.57,
      "factor": 0.97049,
      "team": "VGK"
    },
    "8482155": {
      "shots": 881,
      "goals": 52,
      "xg": 68.687,
      "factor": 0.82,
      "team": "LAK"
    },
    "8482157": {
      "shots": 628,
      "goals": 53,
      "xg": 51.621,
      "factor": 1.01798,
      "team": "NYR"
    },
    "8482159": {
      "shots": 550,
      "goals": 60,
      "xg": 42.932,
      "factor": 1.2,
      "team": "PHI"
    },
    "8482162": {
      "shots": 8,
      "goals": 0,
      "xg": 0.681,
      "factor": 0.99666,
      "team": "OTT"
    },
    "8482165": {
      "shots": 85,
      "goals": 4,
      "xg": 4.522,
      "factor": 0.98663,
      "team": "CGY"
    },
    "8482166": {
      "shots": 128,
      "goals": 7,
      "xg": 6.465,
      "factor": 1.01538,
      "team": "SJS"
    },
    "8482167": {
      "shots": 3,
      "goals": 0,
      "xg": 0.18,
      "factor": 0.99964,
      "team": "WSH"
    },
    "8482168": {
      "shots": 1,
      "goals": 0,
      "xg": 0.04,
      "factor": 0.99997,
      "team": "TBL"
    },
    "8482169": {
      "shots": 8,
      "goals": 0,
      "xg": 0.382,
      "factor": 0.99806,
      "team": "PHI"
    },
    "8482172": {
      "shots": 138,
      "goals": 6,
      "xg": 11.704,
      "factor": 0.87438,
      "team": "CHI"
    },
    "8482174": {
      "shots": 4,
      "goals": 0,
      "xg": 0.16,
      "factor": 0.99957,
      "team": "TOR"
    },
    "8482175": {
      "shots": 840,
      "goals": 82,
      "xg": 64.709,
      "factor": 1.19585,
      "team": "BUF"
    },
    "8482176": {
      "shots": 237,
      "goals": 10,
      "xg": 12.243,
      "factor": 0.93703,
      "team": "CHI"
    },
    "8482177": {
      "shots": 208,
      "goals": 22,
      "xg": 17.443,
      "factor": 1.09601,
      "team": "BOS"
    },
    "8482178": {
      "shots": 122,
      "goals": 4,
      "xg": 6.852,
      "factor": 0.92243,
      "team": "ANA"
    },
    "8482192": {
      "shots": 61,
      "goals": 1,
      "xg": 3.262,
      "factor": 0.94916,
      "team": "CHI"
    },
    "8482201": {
      "shots": 210,
      "goals": 23,
      "xg": 16.866,
      "factor": 1.13282,
      "team": "TBL"
    },
    "8482206": {
      "shots": 22,
      "goals": 2,
      "xg": 1.514,
      "factor": 1.00556,
      "team": "SJS"
    },
    "8482209": {
      "shots": 11,
      "goals": 0,
      "xg": 1.024,
      "factor": 0.99346,
      "team": "CGY"
    },
    "8482213": {
      "shots": 6,
      "goals": 0,
      "xg": 0.362,
      "factor": 0.9986,
      "team": "BOS"
    },
    "8482222": {
      "shots": 111,
      "goals": 4,
      "xg": 9.571,
      "factor": 0.87907,
      "team": "SJS"
    },
    "8482241": {
      "shots": 53,
      "goals": 4,
      "xg": 4.382,
      "factor": 0.99298,
      "team": "PIT"
    },
    "8482245": {
      "shots": 365,
      "goals": 12,
      "xg": 18.288,
      "factor": 0.8398,
      "team": "OTT"
    },
    "8482250": {
      "shots": 15,
      "goals": 1,
      "xg": 1.142,
      "factor": 0.99881,
      "team": "VGK"
    },
    "8482259": {
      "shots": 660,
      "goals": 64,
      "xg": 51.049,
      "factor": 1.17234,
      "team": "TOR"
    },
    "8482408": {
      "shots": 118,
      "goals": 3,
      "xg": 9.592,
      "factor": 0.85163,
      "team": "LAK"
    },
    "8482451": {
      "shots": 83,
      "goals": 5,
      "xg": 5.596,
      "factor": 0.98617,
      "team": "CBJ"
    },
    "8482460": {
      "shots": 87,
      "goals": 5,
      "xg": 7.536,
      "factor": 0.94681,
      "team": "NYR"
    },
    "8482470": {
      "shots": 66,
      "goals": 1,
      "xg": 2.994,
      "factor": 0.95134,
      "team": "COL"
    },
    "8482475": {
      "shots": 506,
      "goals": 47,
      "xg": 35.072,
      "factor": 1.2,
      "team": "CBJ"
    },
    "8482476": {
      "shots": 376,
      "goals": 35,
      "xg": 28.746,
      "factor": 1.1151,
      "team": "NYI"
    },
    "8482482": {
      "shots": 136,
      "goals": 2,
      "xg": 7.522,
      "factor": 0.8469,
      "team": "NSH"
    },
    "8482496": {
      "shots": 53,
      "goals": 4,
      "xg": 4.594,
      "factor": 0.98927,
      "team": "VAN"
    },
    "8482511": {
      "shots": 339,
      "goals": 16,
      "xg": 19.825,
      "factor": 0.91022,
      "team": "BOS"
    },
    "8482516": {
      "shots": 107,
      "goals": 3,
      "xg": 5.401,
      "factor": 0.9332,
      "team": "STL"
    },
    "8482525": {
      "shots": 2,
      "goals": 0,
      "xg": 0.15,
      "factor": 0.9998,
      "team": "TOR"
    },
    "8482623": {
      "shots": 54,
      "goals": 1,
      "xg": 4.152,
      "factor": 0.94014,
      "team": "BUF"
    },
    "8482624": {
      "shots": 148,
      "goals": 5,
      "xg": 7.67,
      "factor": 0.92312,
      "team": "CGY"
    },
    "8482634": {
      "shots": 100,
      "goals": 10,
      "xg": 7.615,
      "factor": 1.05455,
      "team": "BOS"
    },
    "8482635": {
      "shots": 3,
      "goals": 0,
      "xg": 0.239,
      "factor": 0.99952,
      "team": "NJD"
    },
    "8482641": {
      "shots": 5,
      "goals": 0,
      "xg": 0.212,
      "factor": 0.9993,
      "team": "MIN"
    },
    "8482652": {
      "shots": 79,
      "goals": 4,
      "xg": 5.775,
      "factor": 0.9607,
      "team": "CGY"
    },
    "8482655": {
      "shots": 363,
      "goals": 14,
      "xg": 19.77,
      "factor": 0.86109,
      "team": "TBL"
    },
    "8482659": {
      "shots": 425,
      "goals": 37,
      "xg": 35.569,
      "factor": 1.02307,
      "team": "BUF"
    },
    "8482660": {
      "shots": 449,
      "goals": 46,
      "xg": 34.694,
      "factor": 1.18904,
      "team": "CBJ"
    },
    "8482661": {
      "shots": 1,
      "goals": 0,
      "xg": 0.408,
      "factor": 0.99973,
      "team": "MIN"
    },
    "8482663": {
      "shots": 2,
      "goals": 1,
      "xg": 0.157,
      "factor": 1.00114,
      "team": "TBL"
    },
    "8482665": {
      "shots": 696,
      "goals": 58,
      "xg": 57.302,
      "factor": 1.00849,
      "team": "SEA"
    },
    "8482666": {
      "shots": 83,
      "goals": 1,
      "xg": 3.993,
      "factor": 0.92124,
      "team": "CAR"
    },
    "8482667": {
      "shots": 705,
      "goals": 51,
      "xg": 60.46,
      "factor": 0.88992,
      "team": "SJS"
    },
    "8482671": {
      "shots": 529,
      "goals": 22,
      "xg": 31.107,
      "factor": 0.82624,
      "team": "BUF"
    },
    "8482673": {
      "shots": 6,
      "goals": 0,
      "xg": 0.471,
      "factor": 0.9982,
      "team": "OTT"
    },
    "8482679": {
      "shots": 652,
      "goals": 45,
      "xg": 50.22,
      "factor": 0.92973,
      "team": "CGY"
    },
    "8482684": {
      "shots": 594,
      "goals": 22,
      "xg": 33.914,
      "factor": 0.82,
      "team": "NJD"
    },
    "8482691": {
      "shots": 163,
      "goals": 11,
      "xg": 11.936,
      "factor": 0.97768,
      "team": "VAN"
    },
    "8482698": {
      "shots": 2,
      "goals": 0,
      "xg": 0.129,
      "factor": 0.99983,
      "team": "PIT"
    },
    "8482699": {
      "shots": 915,
      "goals": 85,
      "xg": 66.045,
      "factor": 1.2,
      "team": "UTA"
    },
    "8482700": {
      "shots": 33,
      "goals": 1,
      "xg": 1.718,
      "factor": 0.98855,
      "team": "CHI"
    },
    "8482702": {
      "shots": 609,
      "goals": 41,
      "xg": 49.007,
      "factor": 0.89159,
      "team": "CAR"
    },
    "8482703": {
      "shots": 148,
      "goals": 7,
      "xg": 11.751,
      "factor": 0.89146,
      "team": "CHI"
    },
    "8482705": {
      "shots": 598,
      "goals": 32,
      "xg": 46.306,
      "factor": 0.82,
      "team": "CBJ"
    },
    "8482712": {
      "shots": 5,
      "goals": 0,
      "xg": 0.265,
      "factor": 0.99913,
      "team": "COL"
    },
    "8482713": {
      "shots": 489,
      "goals": 27,
      "xg": 37.958,
      "factor": 0.82571,
      "team": "FLA"
    },
    "8482715": {
      "shots": 19,
      "goals": 2,
      "xg": 1.093,
      "factor": 1.00953,
      "team": "NSH"
    },
    "8482720": {
      "shots": 575,
      "goals": 67,
      "xg": 51.823,
      "factor": 1.19321,
      "team": "TOR"
    },
    "8482726": {
      "shots": 110,
      "goals": 9,
      "xg": 8.175,
      "factor": 1.01934,
      "team": "LAK"
    },
    "8482730": {
      "shots": 450,
      "goals": 17,
      "xg": 25.538,
      "factor": 0.82,
      "team": "LAK"
    },
    "8482731": {
      "shots": 12,
      "goals": 0,
      "xg": 0.514,
      "factor": 0.99623,
      "team": "ANA"
    },
    "8482733": {
      "shots": 138,
      "goals": 7,
      "xg": 7.715,
      "factor": 0.98027,
      "team": "STL"
    },
    "8482737": {
      "shots": 420,
      "goals": 36,
      "xg": 31.715,
      "factor": 1.07553,
      "team": "STL"
    },
    "8482740": {
      "shots": 918,
      "goals": 114,
      "xg": 83.246,
      "factor": 1.2,
      "team": "DAL"
    },
    "8482742": {
      "shots": 175,
      "goals": 9,
      "xg": 15.001,
      "factor": 0.87139,
      "team": "NSH"
    },
    "8482744": {
      "shots": 21,
      "goals": 2,
      "xg": 1.503,
      "factor": 1.00546,
      "team": "CBJ"
    },
    "8482745": {
      "shots": 739,
      "goals": 65,
      "xg": 60.652,
      "factor": 1.05093,
      "team": "ANA"
    },
    "8482747": {
      "shots": 66,
      "goals": 2,
      "xg": 4.94,
      "factor": 0.93904,
      "team": "NYR"
    },
    "8482749": {
      "shots": 93,
      "goals": 6,
      "xg": 7.258,
      "factor": 0.97191,
      "team": "MTL"
    },
    "8482751": {
      "shots": 155,
      "goals": 4,
      "xg": 12.247,
      "factor": 0.82,
      "team": "SEA"
    },
    "8482758": {
      "shots": 80,
      "goals": 2,
      "xg": 6.664,
      "factor": 0.90214,
      "team": "PIT"
    },
    "8482762": {
      "shots": 293,
      "goals": 17,
      "xg": 17.552,
      "factor": 0.98661,
      "team": "DET"
    },
    "8482763": {
      "shots": 30,
      "goals": 1,
      "xg": 2.186,
      "factor": 0.98336,
      "team": "BOS"
    },
    "8482765": {
      "shots": 81,
      "goals": 6,
      "xg": 5.819,
      "factor": 1.00406,
      "team": "BUF"
    },
    "8482766": {
      "shots": 2,
      "goals": 0,
      "xg": 0.192,
      "factor": 0.99974,
      "team": "CGY"
    },
    "8482768": {
      "shots": 207,
      "goals": 12,
      "xg": 16.196,
      "factor": 0.90724,
      "team": "NSH"
    },
    "8482775": {
      "shots": 226,
      "goals": 24,
      "xg": 19.117,
      "factor": 1.10024,
      "team": "MTL"
    },
    "8482781": {
      "shots": 2,
      "goals": 0,
      "xg": 0.08,
      "factor": 0.99989,
      "team": "MIN"
    },
    "8482784": {
      "shots": 16,
      "goals": 0,
      "xg": 1.233,
      "factor": 0.9891,
      "team": "STL"
    },
    "8482785": {
      "shots": 6,
      "goals": 1,
      "xg": 0.425,
      "factor": 1.0022,
      "team": "CAR"
    },
    "8482787": {
      "shots": 30,
      "goals": 3,
      "xg": 2.367,
      "factor": 1.00872,
      "team": "WPG"
    },
    "8482802": {
      "shots": 4,
      "goals": 0,
      "xg": 0.315,
      "factor": 0.99918,
      "team": "DET"
    },
    "8482803": {
      "shots": 446,
      "goals": 16,
      "xg": 25.584,
      "factor": 0.82,
      "team": "ANA"
    },
    "8482804": {
      "shots": 1,
      "goals": 0,
      "xg": 0.04,
      "factor": 0.99997,
      "team": "PHI"
    },
    "8482807": {
      "shots": 50,
      "goals": 2,
      "xg": 2.698,
      "factor": 0.98582,
      "team": "CHI"
    },
    "8482809": {
      "shots": 493,
      "goals": 42,
      "xg": 44.823,
      "factor": 0.96085,
      "team": "CAR"
    },
    "8482821": {
      "shots": 1,
      "goals": 0,
      "xg": 0.1,
      "factor": 0.99993,
      "team": "CHI"
    },
    "8482858": {
      "shots": 250,
      "goals": 14,
      "xg": 12.827,
      "factor": 1.03273,
      "team": "SEA"
    },
    "8482859": {
      "shots": 109,
      "goals": 5,
      "xg": 8.917,
      "factor": 0.91267,
      "team": "SJS"
    },
    "8482861": {
      "shots": 32,
      "goals": 0,
      "xg": 1.588,
      "factor": 0.975,
      "team": "SJS"
    },
    "8482866": {
      "shots": 2,
      "goals": 0,
      "xg": 0.08,
      "factor": 0.99989,
      "team": "SEA"
    },
    "8482874": {
      "shots": 67,
      "goals": 2,
      "xg": 5.579,
      "factor": 0.92851,
      "team": "SEA"
    },
    "8482877": {
      "shots": 28,
      "goals": 4,
      "xg": 2.257,
      "factor": 1.02288,
      "team": "NYR"
    },
    "8482896": {
      "shots": 68,
      "goals": 5,
      "xg": 5.659,
      "factor": 0.98677,
      "team": "BUF"
    },
    "8482911": {
      "shots": 63,
      "goals": 1,
      "xg": 2.901,
      "factor": 0.95479,
      "team": "CAR"
    },
    "8482929": {
      "shots": 214,
      "goals": 5,
      "xg": 10.298,
      "factor": 0.84273,
      "team": "TBL"
    },
    "8482947": {
      "shots": 64,
      "goals": 1,
      "xg": 4.707,
      "factor": 0.92348,
      "team": "COL"
    },
    "8482953": {
      "shots": 9,
      "goals": 0,
      "xg": 0.728,
      "factor": 0.99603,
      "team": "COL"
    },
    "8482964": {
      "shots": 262,
      "goals": 5,
      "xg": 11.781,
      "factor": 0.82,
      "team": "MTL"
    },
    "8482982": {
      "shots": 1,
      "goals": 0,
      "xg": 0.1,
      "factor": 0.99993,
      "team": "CBJ"
    },
    "8482993": {
      "shots": 45,
      "goals": 5,
      "xg": 3.251,
      "factor": 1.0311,
      "team": "PIT"
    },
    "8483012": {
      "shots": 10,
      "goals": 0,
      "xg": 0.825,
      "factor": 0.99508,
      "team": "SEA"
    },
    "8483017": {
      "shots": 2,
      "goals": 0,
      "xg": 0.097,
      "factor": 0.99987,
      "team": "BOS"
    },
    "8483039": {
      "shots": 5,
      "goals": 0,
      "xg": 0.416,
      "factor": 0.99866,
      "team": "COL"
    },
    "8483395": {
      "shots": 40,
      "goals": 2,
      "xg": 3.411,
      "factor": 0.97752,
      "team": "VAN"
    },
    "8483397": {
      "shots": 25,
      "goals": 3,
      "xg": 1.891,
      "factor": 1.01367,
      "team": "BOS"
    },
    "8483398": {
      "shots": 58,
      "goals": 2,
      "xg": 3.061,
      "factor": 0.97662,
      "team": "TBL"
    },
    "8483406": {
      "shots": 76,
      "goals": 4,
      "xg": 5.716,
      "factor": 0.96286,
      "team": "LAK"
    },
    "8483424": {
      "shots": 34,
      "goals": 1,
      "xg": 2.61,
      "factor": 0.9759,
      "team": "MTL"
    },
    "8483425": {
      "shots": 99,
      "goals": 8,
      "xg": 4.686,
      "factor": 1.09271,
      "team": "DAL"
    },
    "8483429": {
      "shots": 20,
      "goals": 4,
      "xg": 1.174,
      "factor": 1.0308,
      "team": "NJD"
    },
    "8483431": {
      "shots": 600,
      "goals": 69,
      "xg": 48.55,
      "factor": 1.2,
      "team": "UTA"
    },
    "8483432": {
      "shots": 39,
      "goals": 3,
      "xg": 2.708,
      "factor": 1.00485,
      "team": "CBJ"
    },
    "8483433": {
      "shots": 11,
      "goals": 0,
      "xg": 0.76,
      "factor": 0.99501,
      "team": "FLA"
    },
    "8483435": {
      "shots": 1,
      "goals": 0,
      "xg": 0.04,
      "factor": 0.99997,
      "team": "OTT"
    },
    "8483444": {
      "shots": 2,
      "goals": 0,
      "xg": 0.133,
      "factor": 0.99982,
      "team": "ANA"
    },
    "8483445": {
      "shots": 738,
      "goals": 63,
      "xg": 52.42,
      "factor": 1.14078,
      "team": "ANA"
    },
    "8483447": {
      "shots": 106,
      "goals": 9,
      "xg": 8.457,
      "factor": 1.01224,
      "team": "TBL"
    },
    "8483448": {
      "shots": 41,
      "goals": 1,
      "xg": 1.982,
      "factor": 0.98175,
      "team": "NYI"
    },
    "8483450": {
      "shots": 161,
      "goals": 12,
      "xg": 14.011,
      "factor": 0.95687,
      "team": "CHI"
    },
    "8483452": {
      "shots": 16,
      "goals": 1,
      "xg": 1.282,
      "factor": 0.99752,
      "team": "MIN"
    },
    "8483455": {
      "shots": 57,
      "goals": 2,
      "xg": 4.158,
      "factor": 0.95732,
      "team": "EDM"
    },
    "8483457": {
      "shots": 345,
      "goals": 18,
      "xg": 21.058,
      "factor": 0.93084,
      "team": "MTL"
    },
    "8483460": {
      "shots": 99,
      "goals": 2,
      "xg": 4.869,
      "factor": 0.92089,
      "team": "CBJ"
    },
    "8483463": {
      "shots": 8,
      "goals": 0,
      "xg": 0.487,
      "factor": 0.99756,
      "team": "STL"
    },
    "8483464": {
      "shots": 412,
      "goals": 28,
      "xg": 33.685,
      "factor": 0.90508,
      "team": "DET"
    },
    "8483465": {
      "shots": 31,
      "goals": 1,
      "xg": 2.153,
      "factor": 0.98331,
      "team": "NSH"
    },
    "8483466": {
      "shots": 166,
      "goals": 6,
      "xg": 7.854,
      "factor": 0.94389,
      "team": "CHI"
    },
    "8483467": {
      "shots": 10,
      "goals": 0,
      "xg": 0.469,
      "factor": 0.99709,
      "team": "VAN"
    },
    "8483468": {
      "shots": 231,
      "goals": 18,
      "xg": 18.085,
      "factor": 0.99816,
      "team": "BUF"
    },
    "8483471": {
      "shots": 47,
      "goals": 3,
      "xg": 3.662,
      "factor": 0.98824,
      "team": "WPG"
    },
    "8483472": {
      "shots": 34,
      "goals": 1,
      "xg": 1.637,
      "factor": 0.98951,
      "team": "UTA"
    },
    "8483476": {
      "shots": 63,
      "goals": 6,
      "xg": 4.439,
      "factor": 1.03254,
      "team": "VAN"
    },
    "8483481": {
      "shots": 15,
      "goals": 2,
      "xg": 1.163,
      "factor": 1.00702,
      "team": "SJS"
    },
    "8483482": {
      "shots": 27,
      "goals": 2,
      "xg": 1.457,
      "factor": 1.00749,
      "team": "ANA"
    },
    "8483485": {
      "shots": 203,
      "goals": 17,
      "xg": 11.358,
      "factor": 1.15449,
      "team": "CBJ"
    },
    "8483487": {
      "shots": 71,
      "goals": 4,
      "xg": 5.533,
      "factor": 0.96795,
      "team": "PIT"
    },
    "8483489": {
      "shots": 224,
      "goals": 22,
      "xg": 18.666,
      "factor": 1.06932,
      "team": "BOS"
    },
    "8483490": {
      "shots": 359,
      "goals": 17,
      "xg": 22.42,
      "factor": 0.88132,
      "team": "ANA"
    },
    "8483491": {
      "shots": 109,
      "goals": 5,
      "xg": 8.385,
      "factor": 0.92208,
      "team": "WSH"
    },
    "8483493": {
      "shots": 366,
      "goals": 30,
      "xg": 30.22,
      "factor": 0.99615,
      "team": "CHI"
    },
    "8483495": {
      "shots": 315,
      "goals": 17,
      "xg": 16.962,
      "factor": 1.00097,
      "team": "NJD"
    },
    "8483497": {
      "shots": 98,
      "goals": 7,
      "xg": 7.768,
      "factor": 0.98282,
      "team": "SEA"
    },
    "8483499": {
      "shots": 185,
      "goals": 13,
      "xg": 13.097,
      "factor": 0.99766,
      "team": "VAN"
    },
    "8483500": {
      "shots": 102,
      "goals": 12,
      "xg": 7.859,
      "factor": 1.09445,
      "team": "BUF"
    },
    "8483503": {
      "shots": 29,
      "goals": 1,
      "xg": 1.212,
      "factor": 0.99681,
      "team": "PIT"
    },
    "8483505": {
      "shots": 111,
      "goals": 7,
      "xg": 8.833,
      "factor": 0.95847,
      "team": "BOS"
    },
    "8483506": {
      "shots": 166,
      "goals": 4,
      "xg": 8.691,
      "factor": 0.86516,
      "team": "CHI"
    },
    "8483510": {
      "shots": 65,
      "goals": 1,
      "xg": 3.582,
      "factor": 0.94086,
      "team": "WPG"
    },
    "8483512": {
      "shots": 214,
      "goals": 18,
      "xg": 17.578,
      "factor": 1.00895,
      "team": "EDM"
    },
    "8483513": {
      "shots": 59,
      "goals": 6,
      "xg": 4.639,
      "factor": 1.02659,
      "team": "NSH"
    },
    "8483515": {
      "shots": 764,
      "goals": 69,
      "xg": 68.369,
      "factor": 1.00669,
      "team": "MTL"
    },
    "8483516": {
      "shots": 285,
      "goals": 22,
      "xg": 23.247,
      "factor": 0.97554,
      "team": "STL"
    },
    "8483524": {
      "shots": 340,
      "goals": 35,
      "xg": 29.743,
      "factor": 1.09108,
      "team": "SEA"
    },
    "8483525": {
      "shots": 130,
      "goals": 12,
      "xg": 10.873,
      "factor": 1.02505,
      "team": "MIN"
    },
    "8483526": {
      "shots": 7,
      "goals": 0,
      "xg": 0.499,
      "factor": 0.9978,
      "team": "WPG"
    },
    "8483531": {
      "shots": 23,
      "goals": 1,
      "xg": 1.675,
      "factor": 0.99209,
      "team": "NJD"
    },
    "8483546": {
      "shots": 3,
      "goals": 0,
      "xg": 0.117,
      "factor": 0.99976,
      "team": "TOR"
    },
    "8483549": {
      "shots": 10,
      "goals": 1,
      "xg": 0.806,
      "factor": 1.00116,
      "team": "MTL"
    },
    "8483553": {
      "shots": 133,
      "goals": 11,
      "xg": 10.282,
      "factor": 1.01668,
      "team": "NYI"
    },
    "8483565": {
      "shots": 262,
      "goals": 13,
      "xg": 15.701,
      "factor": 0.93245,
      "team": "NSH"
    },
    "8483567": {
      "shots": 16,
      "goals": 0,
      "xg": 1.144,
      "factor": 0.98979,
      "team": "BOS"
    },
    "8483569": {
      "shots": 4,
      "goals": 1,
      "xg": 0.265,
      "factor": 1.00193,
      "team": "COL"
    },
    "8483570": {
      "shots": 116,
      "goals": 8,
      "xg": 8.89,
      "factor": 0.97935,
      "team": "SEA"
    },
    "8483573": {
      "shots": 164,
      "goals": 16,
      "xg": 14.256,
      "factor": 1.03736,
      "team": "WSH"
    },
    "8483597": {
      "shots": 8,
      "goals": 0,
      "xg": 0.717,
      "factor": 0.9965,
      "team": "ARI"
    },
    "8483609": {
      "shots": 201,
      "goals": 13,
      "xg": 14.698,
      "factor": 0.96053,
      "team": "CGY"
    },
    "8483619": {
      "shots": 4,
      "goals": 0,
      "xg": 0.16,
      "factor": 0.99957,
      "team": "CHI"
    },
    "8483630": {
      "shots": 67,
      "goals": 9,
      "xg": 5.647,
      "factor": 1.06664,
      "team": "SJS"
    },
    "8483669": {
      "shots": 23,
      "goals": 3,
      "xg": 1.843,
      "factor": 1.01332,
      "team": "NYR"
    },
    "8483675": {
      "shots": 6,
      "goals": 0,
      "xg": 0.332,
      "factor": 0.99872,
      "team": "LAK"
    },
    "8483676": {
      "shots": 44,
      "goals": 4,
      "xg": 3.653,
      "factor": 1.00585,
      "team": "OTT"
    },
    "8483678": {
      "shots": 127,
      "goals": 4,
      "xg": 6.036,
      "factor": 0.93999,
      "team": "VAN"
    },
    "8483686": {
      "shots": 17,
      "goals": 0,
      "xg": 0.857,
      "factor": 0.99165,
      "team": "MTL"
    },
    "8483687": {
      "shots": 10,
      "goals": 0,
      "xg": 0.595,
      "factor": 0.99636,
      "team": "FLA"
    },
    "8483690": {
      "shots": 117,
      "goals": 9,
      "xg": 10.262,
      "factor": 0.97277,
      "team": "NYR"
    },
    "8483696": {
      "shots": 1,
      "goals": 0,
      "xg": 0.092,
      "factor": 0.99994,
      "team": "NSH"
    },
    "8483699": {
      "shots": 2,
      "goals": 1,
      "xg": 0.14,
      "factor": 1.00116,
      "team": "LAK"
    },
    "8483709": {
      "shots": 2,
      "goals": 0,
      "xg": 0.08,
      "factor": 0.99989,
      "team": "CGY"
    },
    "8483712": {
      "shots": 4,
      "goals": 0,
      "xg": 0.16,
      "factor": 0.99957,
      "team": "FLA"
    },
    "8483728": {
      "shots": 13,
      "goals": 0,
      "xg": 1.029,
      "factor": 0.99232,
      "team": "MTL"
    },
    "8483731": {
      "shots": 41,
      "goals": 5,
      "xg": 3.569,
      "factor": 1.02295,
      "team": "PHI"
    },
    "8483733": {
      "shots": 49,
      "goals": 4,
      "xg": 3.921,
      "factor": 1.00142,
      "team": "PHI"
    },
    "8483752": {
      "shots": 86,
      "goals": 8,
      "xg": 6.588,
      "factor": 1.03129,
      "team": "TBL"
    },
    "8483756": {
      "shots": 40,
      "goals": 0,
      "xg": 3.353,
      "factor": 0.9463,
      "team": "LAK"
    },
    "8483763": {
      "shots": 2,
      "goals": 0,
      "xg": 0.08,
      "factor": 0.99989,
      "team": "ARI"
    },
    "8483768": {
      "shots": 61,
      "goals": 2,
      "xg": 3.15,
      "factor": 0.97389,
      "team": "VAN"
    },
    "8483771": {
      "shots": 27,
      "goals": 3,
      "xg": 2.182,
      "factor": 1.01048,
      "team": "FLA"
    },
    "8483808": {
      "shots": 459,
      "goals": 47,
      "xg": 37.77,
      "factor": 1.14485,
      "team": "LAK"
    },
    "8483841": {
      "shots": 6,
      "goals": 0,
      "xg": 0.431,
      "factor": 0.99835,
      "team": "NJD"
    },
    "8483890": {
      "shots": 120,
      "goals": 8,
      "xg": 10.699,
      "factor": 0.94227,
      "team": "VGK"
    },
    "8483920": {
      "shots": 5,
      "goals": 0,
      "xg": 0.342,
      "factor": 0.99889,
      "team": "WSH"
    },
    "8483930": {
      "shots": 56,
      "goals": 5,
      "xg": 4.706,
      "factor": 1.0055,
      "team": "COL"
    },
    "8484135": {
      "shots": 24,
      "goals": 1,
      "xg": 1.701,
      "factor": 0.9915,
      "team": "WPG"
    },
    "8484136": {
      "shots": 130,
      "goals": 16,
      "xg": 10.225,
      "factor": 1.13288,
      "team": "VAN"
    },
    "8484142": {
      "shots": 65,
      "goals": 5,
      "xg": 5.869,
      "factor": 0.98338,
      "team": "PHI"
    },
    "8484144": {
      "shots": 935,
      "goals": 80,
      "xg": 71.16,
      "factor": 1.09364,
      "team": "CHI"
    },
    "8484145": {
      "shots": 488,
      "goals": 34,
      "xg": 43.609,
      "factor": 0.86398,
      "team": "BUF"
    },
    "8484148": {
      "shots": 1,
      "goals": 1,
      "xg": 0.04,
      "factor": 1.00066,
      "team": "PHI"
    },
    "8484149": {
      "shots": 91,
      "goals": 6,
      "xg": 7.51,
      "factor": 0.9673,
      "team": "COL"
    },
    "8484150": {
      "shots": 49,
      "goals": 2,
      "xg": 2.312,
      "factor": 0.99352,
      "team": "CGY"
    },
    "8484152": {
      "shots": 17,
      "goals": 0,
      "xg": 1.01,
      "factor": 0.99033,
      "team": "SJS"
    },
    "8484153": {
      "shots": 608,
      "goals": 66,
      "xg": 49.607,
      "factor": 1.2,
      "team": "ANA"
    },
    "8484158": {
      "shots": 144,
      "goals": 11,
      "xg": 10.833,
      "factor": 1.00395,
      "team": "TOR"
    },
    "8484160": {
      "shots": 49,
      "goals": 2,
      "xg": 3.878,
      "factor": 0.96617,
      "team": "DET"
    },
    "8484164": {
      "shots": 146,
      "goals": 13,
      "xg": 11.363,
      "factor": 1.03785,
      "team": "STL"
    },
    "8484166": {
      "shots": 782,
      "goals": 70,
      "xg": 62.432,
      "factor": 1.08734,
      "team": "CBJ"
    },
    "8484168": {
      "shots": 10,
      "goals": 0,
      "xg": 0.713,
      "factor": 0.99569,
      "team": "SEA"
    },
    "8484169": {
      "shots": 8,
      "goals": 0,
      "xg": 0.329,
      "factor": 0.99832,
      "team": "NYR"
    },
    "8484177": {
      "shots": 76,
      "goals": 2,
      "xg": 5.032,
      "factor": 0.93092,
      "team": "NJD"
    },
    "8484180": {
      "shots": 42,
      "goals": 2,
      "xg": 3.469,
      "factor": 0.97577,
      "team": "CGY"
    },
    "8484185": {
      "shots": 100,
      "goals": 12,
      "xg": 7.83,
      "factor": 1.09407,
      "team": "CHI"
    },
    "8484186": {
      "shots": 267,
      "goals": 22,
      "xg": 19.114,
      "factor": 1.06357,
      "team": "WSH"
    },
    "8484188": {
      "shots": 31,
      "goals": 2,
      "xg": 1.609,
      "factor": 1.00597,
      "team": "STL"
    },
    "8484197": {
      "shots": 109,
      "goals": 6,
      "xg": 7.914,
      "factor": 0.95464,
      "team": "CHI"
    },
    "8484203": {
      "shots": 41,
      "goals": 3,
      "xg": 3.339,
      "factor": 0.99445,
      "team": "CAR"
    },
    "8484210": {
      "shots": 114,
      "goals": 12,
      "xg": 10.046,
      "factor": 1.042,
      "team": "NYR"
    },
    "8484214": {
      "shots": 9,
      "goals": 0,
      "xg": 0.709,
      "factor": 0.99612,
      "team": "CBJ"
    },
    "8484220": {
      "shots": 4,
      "goals": 0,
      "xg": 0.16,
      "factor": 0.99957,
      "team": "MTL"
    },
    "8484221": {
      "shots": 132,
      "goals": 14,
      "xg": 10.765,
      "factor": 1.07294,
      "team": "NYI"
    },
    "8484223": {
      "shots": 122,
      "goals": 7,
      "xg": 5.863,
      "factor": 1.03313,
      "team": "DET"
    },
    "8484227": {
      "shots": 436,
      "goals": 43,
      "xg": 32.607,
      "factor": 1.18115,
      "team": "SJS"
    },
    "8484230": {
      "shots": 54,
      "goals": 3,
      "xg": 4.444,
      "factor": 0.97322,
      "team": "STL"
    },
    "8484234": {
      "shots": 12,
      "goals": 0,
      "xg": 0.888,
      "factor": 0.99375,
      "team": "CGY"
    },
    "8484240": {
      "shots": 100,
      "goals": 5,
      "xg": 5.006,
      "factor": 0.99982,
      "team": "VAN"
    },
    "8484241": {
      "shots": 164,
      "goals": 17,
      "xg": 13.228,
      "factor": 1.08471,
      "team": "NSH"
    },
    "8484242": {
      "shots": 4,
      "goals": 0,
      "xg": 0.241,
      "factor": 0.99936,
      "team": "WPG"
    },
    "8484255": {
      "shots": 13,
      "goals": 1,
      "xg": 0.962,
      "factor": 1.00029,
      "team": "COL"
    },
    "8484258": {
      "shots": 462,
      "goals": 16,
      "xg": 21.693,
      "factor": 0.86202,
      "team": "COL"
    },
    "8484259": {
      "shots": 4,
      "goals": 0,
      "xg": 0.366,
      "factor": 0.99905,
      "team": "COL"
    },
    "8484262": {
      "shots": 7,
      "goals": 1,
      "xg": 0.349,
      "factor": 1.00292,
      "team": "NYI"
    },
    "8484287": {
      "shots": 2,
      "goals": 0,
      "xg": 0.14,
      "factor": 0.99981,
      "team": "VAN"
    },
    "8484304": {
      "shots": 242,
      "goals": 10,
      "xg": 12.513,
      "factor": 0.92973,
      "team": "FLA"
    },
    "8484305": {
      "shots": 35,
      "goals": 2,
      "xg": 1.713,
      "factor": 1.00481,
      "team": "BUF"
    },
    "8484314": {
      "shots": 24,
      "goals": 1,
      "xg": 2.025,
      "factor": 0.98797,
      "team": "OTT"
    },
    "8484321": {
      "shots": 126,
      "goals": 1,
      "xg": 6.224,
      "factor": 0.84876,
      "team": "OTT"
    },
    "8484325": {
      "shots": 19,
      "goals": 1,
      "xg": 1.495,
      "factor": 0.99502,
      "team": "TBL"
    },
    "8484326": {
      "shots": 1,
      "goals": 0,
      "xg": 0.04,
      "factor": 0.99997,
      "team": "ARI"
    },
    "8484380": {
      "shots": 7,
      "goals": 0,
      "xg": 0.599,
      "factor": 0.99739,
      "team": "FLA"
    },
    "8484386": {
      "shots": 36,
      "goals": 0,
      "xg": 1.871,
      "factor": 0.96841,
      "team": "UTA"
    },
    "8484387": {
      "shots": 534,
      "goals": 53,
      "xg": 43.688,
      "factor": 1.13474,
      "team": "PHI"
    },
    "8484388": {
      "shots": 69,
      "goals": 3,
      "xg": 5.803,
      "factor": 0.94372,
      "team": "UTA"
    },
    "8484392": {
      "shots": 2,
      "goals": 0,
      "xg": 0.192,
      "factor": 0.99974,
      "team": "CAR"
    },
    "8484403": {
      "shots": 5,
      "goals": 0,
      "xg": 0.319,
      "factor": 0.99896,
      "team": "MTL"
    },
    "8484406": {
      "shots": 7,
      "goals": 1,
      "xg": 0.589,
      "factor": 1.00179,
      "team": "VAN"
    },
    "8484428": {
      "shots": 22,
      "goals": 1,
      "xg": 1.392,
      "factor": 0.99545,
      "team": "CAR"
    },
    "8484471": {
      "shots": 177,
      "goals": 13,
      "xg": 15.741,
      "factor": 0.94276,
      "team": "DET"
    },
    "8484509": {
      "shots": 20,
      "goals": 2,
      "xg": 1.573,
      "factor": 1.00446,
      "team": "EDM"
    },
    "8484529": {
      "shots": 5,
      "goals": 1,
      "xg": 0.456,
      "factor": 1.00174,
      "team": "EDM"
    },
    "8484759": {
      "shots": 9,
      "goals": 1,
      "xg": 0.434,
      "factor": 1.00319,
      "team": "OTT"
    },
    "8484762": {
      "shots": 314,
      "goals": 24,
      "xg": 25.633,
      "factor": 0.96914,
      "team": "ANA"
    },
    "8484768": {
      "shots": 80,
      "goals": 5,
      "xg": 4.678,
      "factor": 1.00781,
      "team": "CGY"
    },
    "8484779": {
      "shots": 8,
      "goals": 0,
      "xg": 0.731,
      "factor": 0.99644,
      "team": "PHI"
    },
    "8484783": {
      "shots": 164,
      "goals": 2,
      "xg": 9.039,
      "factor": 0.82,
      "team": "CHI"
    },
    "8484793": {
      "shots": 8,
      "goals": 1,
      "xg": 0.543,
      "factor": 1.00227,
      "team": "CHI"
    },
    "8484794": {
      "shots": 31,
      "goals": 0,
      "xg": 1.982,
      "factor": 0.97083,
      "team": "DET"
    },
    "8484797": {
      "shots": 22,
      "goals": 1,
      "xg": 1.375,
      "factor": 0.99565,
      "team": "BUF"
    },
    "8484798": {
      "shots": 112,
      "goals": 6,
      "xg": 6.188,
      "factor": 0.99492,
      "team": "VAN"
    },
    "8484800": {
      "shots": 132,
      "goals": 8,
      "xg": 10.874,
      "factor": 0.93558,
      "team": "SEA"
    },
    "8484801": {
      "shots": 774,
      "goals": 73,
      "xg": 58.146,
      "factor": 1.18219,
      "team": "SJS"
    },
    "8484806": {
      "shots": 123,
      "goals": 1,
      "xg": 6.368,
      "factor": 0.84833,
      "team": "SJS"
    },
    "8484821": {
      "shots": 8,
      "goals": 1,
      "xg": 0.713,
      "factor": 1.0014,
      "team": "CGY"
    },
    "8484829": {
      "shots": 130,
      "goals": 14,
      "xg": 11.055,
      "factor": 1.06482,
      "team": "DAL"
    },
    "8484839": {
      "shots": 15,
      "goals": 1,
      "xg": 0.747,
      "factor": 1.00223,
      "team": "PIT"
    },
    "8484860": {
      "shots": 106,
      "goals": 7,
      "xg": 7.81,
      "factor": 0.98102,
      "team": "CGY"
    },
    "8484873": {
      "shots": 39,
      "goals": 3,
      "xg": 3.003,
      "factor": 0.99996,
      "team": "WSH"
    },
    "8484901": {
      "shots": 24,
      "goals": 1,
      "xg": 1.687,
      "factor": 0.99166,
      "team": "TOR"
    },
    "8484911": {
      "shots": 234,
      "goals": 26,
      "xg": 21.305,
      "factor": 1.09055,
      "team": "SJS"
    },
    "8484929": {
      "shots": 22,
      "goals": 0,
      "xg": 1.711,
      "factor": 0.98081,
      "team": "CAR"
    },
    "8484933": {
      "shots": 5,
      "goals": 0,
      "xg": 0.379,
      "factor": 0.99878,
      "team": "FLA"
    },
    "8484938": {
      "shots": 43,
      "goals": 3,
      "xg": 3.196,
      "factor": 0.99662,
      "team": "DAL"
    },
    "8484958": {
      "shots": 264,
      "goals": 12,
      "xg": 20.352,
      "factor": 0.82485,
      "team": "NYI"
    },
    "8484976": {
      "shots": 17,
      "goals": 0,
      "xg": 1.403,
      "factor": 0.98712,
      "team": "COL"
    },
    "8484984": {
      "shots": 221,
      "goals": 22,
      "xg": 16.969,
      "factor": 1.11105,
      "team": "MTL"
    },
    "8484994": {
      "shots": 72,
      "goals": 9,
      "xg": 6.381,
      "factor": 1.05202,
      "team": "SJS"
    },
    "8484999": {
      "shots": 9,
      "goals": 1,
      "xg": 0.828,
      "factor": 1.00093,
      "team": "WSH"
    },
    "8485105": {
      "shots": 7,
      "goals": 0,
      "xg": 0.372,
      "factor": 0.99834,
      "team": "COL"
    },
    "8485251": {
      "shots": 2,
      "goals": 0,
      "xg": 0.157,
      "factor": 0.99979,
      "team": "VGK"
    },
    "8485366": {
      "shots": 306,
      "goals": 23,
      "xg": 18.026,
      "factor": 1.12032,
      "team": "NYI"
    },
    "8485388": {
      "shots": 2,
      "goals": 0,
      "xg": 0.149,
      "factor": 0.9998,
      "team": "NYI"
    },
    "8485391": {
      "shots": 53,
      "goals": 3,
      "xg": 4.122,
      "factor": 0.97894,
      "team": "CHI"
    },
    "8485395": {
      "shots": 3,
      "goals": 0,
      "xg": 0.197,
      "factor": 0.99961,
      "team": "BOS"
    },
    "8485402": {
      "shots": 82,
      "goals": 9,
      "xg": 7.398,
      "factor": 1.03256,
      "team": "SJS"
    },
    "8485405": {
      "shots": 3,
      "goals": 0,
      "xg": 0.154,
      "factor": 0.99969,
      "team": "NSH"
    },
    "8485406": {
      "shots": 42,
      "goals": 4,
      "xg": 3.215,
      "factor": 1.01325,
      "team": "PHI"
    },
    "8485414": {
      "shots": 221,
      "goals": 19,
      "xg": 18.128,
      "factor": 1.01839,
      "team": "PIT"
    },
    "8485467": {
      "shots": 6,
      "goals": 0,
      "xg": 0.436,
      "factor": 0.99833,
      "team": "TOR"
    },
    "8485469": {
      "shots": 1,
      "goals": 0,
      "xg": 0.04,
      "factor": 0.99997,
      "team": "CBJ"
    },
    "8485483": {
      "shots": 5,
      "goals": 0,
      "xg": 0.42,
      "factor": 0.99865,
      "team": "PHI"
    },
    "8485493": {
      "shots": 46,
      "goals": 3,
      "xg": 3.621,
      "factor": 0.98912,
      "team": "EDM"
    },
    "8485511": {
      "shots": 7,
      "goals": 1,
      "xg": 0.426,
      "factor": 1.00255,
      "team": "EDM"
    },
    "8485512": {
      "shots": 67,
      "goals": 2,
      "xg": 5.483,
      "factor": 0.92992,
      "team": "ANA"
    },
    "8485702": {
      "shots": 86,
      "goals": 5,
      "xg": 6.475,
      "factor": 0.96706,
      "team": "NYI"
    },
    "8486056": {
      "shots": 7,
      "goals": 1,
      "xg": 0.642,
      "factor": 1.00155,
      "team": "CGY"
    }
  },
  "goalies": {
    "8470594": {
      "shots": 2527,
      "goals": 185,
      "xg": 174.316,
      "gsax": -10.684,
      "impactPerShot": -0.003589,
      "team": "MIN"
    },
    "8471734": {
      "shots": 3186,
      "goals": 215,
      "xg": 225.364,
      "gsax": 10.364,
      "impactPerShot": 0.00285,
      "team": "NYR"
    },
    "8473503": {
      "shots": 2602,
      "goals": 174,
      "xg": 185.176,
      "gsax": 11.176,
      "impactPerShot": 0.003662,
      "team": "DET"
    },
    "8473575": {
      "shots": 1641,
      "goals": 105,
      "xg": 117.078,
      "gsax": 12.078,
      "impactPerShot": 0.005776,
      "team": "NYI"
    },
    "8474593": {
      "shots": 5649,
      "goals": 389,
      "xg": 403.397,
      "gsax": 14.397,
      "impactPerShot": 0.002361,
      "team": "NJD"
    },
    "8474596": {
      "shots": 4388,
      "goals": 297,
      "xg": 317.417,
      "gsax": 20.417,
      "impactPerShot": 0.00422,
      "team": "NJD"
    },
    "8474636": {
      "shots": 52,
      "goals": 3,
      "xg": 3.588,
      "gsax": 0.588,
      "impactPerShot": 0.00117,
      "team": "DET"
    },
    "8474682": {
      "shots": 207,
      "goals": 13,
      "xg": 14.299,
      "gsax": 1.299,
      "impactPerShot": 0.001977,
      "team": "CAR"
    },
    "8474889": {
      "shots": 857,
      "goals": 56,
      "xg": 62.226,
      "gsax": 6.226,
      "impactPerShot": 0.004764,
      "team": "TOR"
    },
    "8475311": {
      "shots": 5282,
      "goals": 359,
      "xg": 377.166,
      "gsax": 18.166,
      "impactPerShot": 0.003169,
      "team": "LAK"
    },
    "8475660": {
      "shots": 5335,
      "goals": 362,
      "xg": 378.123,
      "gsax": 16.123,
      "impactPerShot": 0.002787,
      "team": "DET"
    },
    "8475683": {
      "shots": 6276,
      "goals": 425,
      "xg": 444.031,
      "gsax": 19.031,
      "impactPerShot": 0.00283,
      "team": "FLA"
    },
    "8475717": {
      "shots": 2643,
      "goals": 191,
      "xg": 187.941,
      "gsax": -3.059,
      "impactPerShot": -0.000989,
      "team": "EDM"
    },
    "8475789": {
      "shots": 203,
      "goals": 20,
      "xg": 15.363,
      "gsax": -4.637,
      "impactPerShot": -0.0071,
      "team": "EDM"
    },
    "8475809": {
      "shots": 3813,
      "goals": 238,
      "xg": 268.459,
      "gsax": 30.459,
      "impactPerShot": 0.007145,
      "team": "COL"
    },
    "8475831": {
      "shots": 3807,
      "goals": 270,
      "xg": 270.601,
      "gsax": 0.601,
      "impactPerShot": 0.000141,
      "team": "SEA"
    },
    "8475839": {
      "shots": 82,
      "goals": 3,
      "xg": 5.493,
      "gsax": 2.493,
      "impactPerShot": 0.004686,
      "team": "NYR"
    },
    "8475852": {
      "shots": 4366,
      "goals": 314,
      "xg": 314.188,
      "gsax": 0.188,
      "impactPerShot": 0.000039,
      "team": "CHI"
    },
    "8475883": {
      "shots": 2733,
      "goals": 197,
      "xg": 204.227,
      "gsax": 7.227,
      "impactPerShot": 0.002271,
      "team": "CAR"
    },
    "8476316": {
      "shots": 972,
      "goals": 52,
      "xg": 68.624,
      "gsax": 16.624,
      "impactPerShot": 0.01169,
      "team": "WPG"
    },
    "8476341": {
      "shots": 3699,
      "goals": 250,
      "xg": 260.998,
      "gsax": 10.998,
      "impactPerShot": 0.002651,
      "team": "OTT"
    },
    "8476412": {
      "shots": 6306,
      "goals": 443,
      "xg": 456.431,
      "gsax": 13.431,
      "impactPerShot": 0.001988,
      "team": "STL"
    },
    "8476433": {
      "shots": 85,
      "goals": 5,
      "xg": 6.242,
      "gsax": 1.242,
      "impactPerShot": 0.002322,
      "team": "PIT"
    },
    "8476434": {
      "shots": 5473,
      "goals": 375,
      "xg": 394.552,
      "gsax": 19.552,
      "impactPerShot": 0.003301,
      "team": "ANA"
    },
    "8476876": {
      "shots": 53,
      "goals": 3,
      "xg": 3.863,
      "gsax": 0.863,
      "impactPerShot": 0.001716,
      "team": "CBJ"
    },
    "8476883": {
      "shots": 6837,
      "goals": 426,
      "xg": 487.439,
      "gsax": 61.439,
      "impactPerShot": 0.008431,
      "team": "TBL"
    },
    "8476899": {
      "shots": 256,
      "goals": 17,
      "xg": 17.587,
      "gsax": 0.587,
      "impactPerShot": 0.000831,
      "team": "SEA"
    },
    "8476904": {
      "shots": 92,
      "goals": 5,
      "xg": 6.415,
      "gsax": 1.415,
      "impactPerShot": 0.002611,
      "team": "SEA"
    },
    "8476914": {
      "shots": 4505,
      "goals": 334,
      "xg": 321.237,
      "gsax": -12.763,
      "impactPerShot": -0.002576,
      "team": "BOS"
    },
    "8476932": {
      "shots": 3597,
      "goals": 207,
      "xg": 256.414,
      "gsax": 49.414,
      "impactPerShot": 0.01221,
      "team": "TOR"
    },
    "8476945": {
      "shots": 7548,
      "goals": 436,
      "xg": 536.456,
      "gsax": 100.456,
      "impactPerShot": 0.01256,
      "team": "WPG"
    },
    "8476999": {
      "shots": 5362,
      "goals": 354,
      "xg": 384.405,
      "gsax": 30.405,
      "impactPerShot": 0.005231,
      "team": "OTT"
    },
    "8477035": {
      "shots": 267,
      "goals": 21,
      "xg": 19.218,
      "gsax": -1.782,
      "impactPerShot": -0.002485,
      "team": "TBL"
    },
    "8477293": {
      "shots": 713,
      "goals": 65,
      "xg": 51.528,
      "gsax": -13.472,
      "impactPerShot": -0.011583,
      "team": "CAR"
    },
    "8477361": {
      "shots": 193,
      "goals": 18,
      "xg": 13.198,
      "gsax": -4.802,
      "impactPerShot": -0.007468,
      "team": "PHI"
    },
    "8477405": {
      "shots": 532,
      "goals": 44,
      "xg": 37.923,
      "gsax": -6.077,
      "impactPerShot": -0.006189,
      "team": "NYI"
    },
    "8477424": {
      "shots": 7404,
      "goals": 528,
      "xg": 531.938,
      "gsax": 3.938,
      "impactPerShot": 0.000501,
      "team": "NSH"
    },
    "8477465": {
      "shots": 4845,
      "goals": 343,
      "xg": 349.02,
      "gsax": 6.02,
      "impactPerShot": 0.001137,
      "team": "PIT"
    },
    "8477480": {
      "shots": 2240,
      "goals": 152,
      "xg": 157.807,
      "gsax": 5.807,
      "impactPerShot": 0.002159,
      "team": "WPG"
    },
    "8477484": {
      "shots": 1280,
      "goals": 108,
      "xg": 93.775,
      "gsax": -14.225,
      "impactPerShot": -0.008222,
      "team": "CBJ"
    },
    "8477831": {
      "shots": 327,
      "goals": 31,
      "xg": 24.725,
      "gsax": -6.275,
      "impactPerShot": -0.008075,
      "team": "LAK"
    },
    "8477967": {
      "shots": 3793,
      "goals": 242,
      "xg": 275.352,
      "gsax": 33.352,
      "impactPerShot": 0.00786,
      "team": "VAN"
    },
    "8477968": {
      "shots": 4713,
      "goals": 340,
      "xg": 335.305,
      "gsax": -4.695,
      "impactPerShot": -0.000909,
      "team": "PIT"
    },
    "8477970": {
      "shots": 3057,
      "goals": 240,
      "xg": 217.476,
      "gsax": -22.524,
      "impactPerShot": -0.006423,
      "team": "NJD"
    },
    "8477990": {
      "shots": 67,
      "goals": 9,
      "xg": 5.002,
      "gsax": -3.998,
      "impactPerShot": -0.007733,
      "team": "TBL"
    },
    "8477992": {
      "shots": 2867,
      "goals": 225,
      "xg": 204.106,
      "gsax": -20.894,
      "impactPerShot": -0.006299,
      "team": "TBL"
    },
    "8478007": {
      "shots": 5408,
      "goals": 401,
      "xg": 387.467,
      "gsax": -13.533,
      "impactPerShot": -0.00231,
      "team": "CBJ"
    },
    "8478009": {
      "shots": 7523,
      "goals": 481,
      "xg": 541.911,
      "gsax": 60.911,
      "impactPerShot": 0.00764,
      "team": "NYI"
    },
    "8478024": {
      "shots": 2156,
      "goals": 160,
      "xg": 154.484,
      "gsax": -5.516,
      "impactPerShot": -0.002116,
      "team": "DET"
    },
    "8478039": {
      "shots": 1713,
      "goals": 122,
      "xg": 123.443,
      "gsax": 1.443,
      "impactPerShot": 0.000667,
      "team": "SJS"
    },
    "8478048": {
      "shots": 7091,
      "goals": 438,
      "xg": 507.874,
      "gsax": 69.874,
      "impactPerShot": 0.009266,
      "team": "NYR"
    },
    "8478406": {
      "shots": 5772,
      "goals": 383,
      "xg": 415.582,
      "gsax": 32.582,
      "impactPerShot": 0.005237,
      "team": "COL"
    },
    "8478433": {
      "shots": 150,
      "goals": 17,
      "xg": 11.032,
      "gsax": -5.968,
      "impactPerShot": -0.009947,
      "team": "PHI"
    },
    "8478435": {
      "shots": 4115,
      "goals": 281,
      "xg": 293.774,
      "gsax": 12.774,
      "impactPerShot": 0.002798,
      "team": "CGY"
    },
    "8478470": {
      "shots": 5488,
      "goals": 389,
      "xg": 401.065,
      "gsax": 12.065,
      "impactPerShot": 0.002032,
      "team": "MTL"
    },
    "8478492": {
      "shots": 2874,
      "goals": 207,
      "xg": 201.615,
      "gsax": -5.385,
      "impactPerShot": -0.00162,
      "team": "TOR"
    },
    "8478499": {
      "shots": 4455,
      "goals": 300,
      "xg": 313.616,
      "gsax": 13.616,
      "impactPerShot": 0.002776,
      "team": "VGK"
    },
    "8478848": {
      "shots": 42,
      "goals": 3,
      "xg": 3.116,
      "gsax": 0.116,
      "impactPerShot": 0.000236,
      "team": "SEA"
    },
    "8478872": {
      "shots": 6316,
      "goals": 432,
      "xg": 452.66,
      "gsax": 20.66,
      "impactPerShot": 0.003053,
      "team": "UTA"
    },
    "8478905": {
      "shots": 1026,
      "goals": 88,
      "xg": 72.672,
      "gsax": -15.328,
      "impactPerShot": -0.010385,
      "team": "PHI"
    },
    "8478916": {
      "shots": 6667,
      "goals": 418,
      "xg": 467.336,
      "gsax": 49.336,
      "impactPerShot": 0.006932,
      "team": "SEA"
    },
    "8478965": {
      "shots": 12,
      "goals": 2,
      "xg": 0.843,
      "gsax": -1.157,
      "impactPerShot": -0.002504,
      "team": "NYI"
    },
    "8478971": {
      "shots": 4170,
      "goals": 283,
      "xg": 299.926,
      "gsax": 16.926,
      "impactPerShot": 0.003664,
      "team": "ARI"
    },
    "8479193": {
      "shots": 3431,
      "goals": 225,
      "xg": 245.964,
      "gsax": 20.964,
      "impactPerShot": 0.005402,
      "team": "DAL"
    },
    "8479292": {
      "shots": 4597,
      "goals": 318,
      "xg": 325.05,
      "gsax": 7.05,
      "impactPerShot": 0.001397,
      "team": "WSH"
    },
    "8479312": {
      "shots": 4522,
      "goals": 294,
      "xg": 322.044,
      "gsax": 28.044,
      "impactPerShot": 0.00564,
      "team": "DET"
    },
    "8479361": {
      "shots": 4790,
      "goals": 314,
      "xg": 340.734,
      "gsax": 26.734,
      "impactPerShot": 0.005102,
      "team": "TOR"
    },
    "8479394": {
      "shots": 1692,
      "goals": 121,
      "xg": 121.036,
      "gsax": 0.036,
      "impactPerShot": 0.000017,
      "team": "PHI"
    },
    "8479406": {
      "shots": 6572,
      "goals": 417,
      "xg": 458.21,
      "gsax": 41.21,
      "impactPerShot": 0.005869,
      "team": "MIN"
    },
    "8479496": {
      "shots": 3274,
      "goals": 226,
      "xg": 234.446,
      "gsax": 8.446,
      "impactPerShot": 0.002268,
      "team": "LAK"
    },
    "8479973": {
      "shots": 6255,
      "goals": 442,
      "xg": 456.116,
      "gsax": 14.116,
      "impactPerShot": 0.002105,
      "team": "EDM"
    },
    "8479979": {
      "shots": 6710,
      "goals": 441,
      "xg": 473.566,
      "gsax": 32.566,
      "impactPerShot": 0.004548,
      "team": "DAL"
    },
    "8480022": {
      "shots": 3,
      "goals": 0,
      "xg": 0.25,
      "gsax": 0.25,
      "impactPerShot": 0.000551,
      "team": "BOS"
    },
    "8480045": {
      "shots": 5895,
      "goals": 390,
      "xg": 419.416,
      "gsax": 29.416,
      "impactPerShot": 0.004636,
      "team": "BUF"
    },
    "8480051": {
      "shots": 1592,
      "goals": 131,
      "xg": 115.755,
      "gsax": -15.245,
      "impactPerShot": -0.007466,
      "team": "MTL"
    },
    "8480191": {
      "shots": 93,
      "goals": 8,
      "xg": 7.056,
      "gsax": -0.944,
      "impactPerShot": -0.001738,
      "team": "ARI"
    },
    "8480193": {
      "shots": 3323,
      "goals": 240,
      "xg": 236.638,
      "gsax": -3.362,
      "impactPerShot": -0.000891,
      "team": "CBJ"
    },
    "8480238": {
      "shots": 319,
      "goals": 28,
      "xg": 22.308,
      "gsax": -5.692,
      "impactPerShot": -0.007402,
      "team": "VGK"
    },
    "8480280": {
      "shots": 6823,
      "goals": 438,
      "xg": 488.633,
      "gsax": 50.633,
      "impactPerShot": 0.006962,
      "team": "BOS"
    },
    "8480313": {
      "shots": 6183,
      "goals": 377,
      "xg": 441.35,
      "gsax": 64.35,
      "impactPerShot": 0.009702,
      "team": "WSH"
    },
    "8480382": {
      "shots": 4485,
      "goals": 353,
      "xg": 326.473,
      "gsax": -26.527,
      "impactPerShot": -0.005375,
      "team": "COL"
    },
    "8480819": {
      "shots": 51,
      "goals": 5,
      "xg": 3.704,
      "gsax": -1.296,
      "impactPerShot": -0.002588,
      "team": "NYI"
    },
    "8480843": {
      "shots": 6754,
      "goals": 464,
      "xg": 490.497,
      "gsax": 26.497,
      "impactPerShot": 0.003678,
      "team": "ANA"
    },
    "8480885": {
      "shots": 49,
      "goals": 4,
      "xg": 3.664,
      "gsax": -0.336,
      "impactPerShot": -0.000673,
      "team": "EDM"
    },
    "8480947": {
      "shots": 4896,
      "goals": 353,
      "xg": 354.395,
      "gsax": 1.395,
      "impactPerShot": 0.000261,
      "team": "VAN"
    },
    "8480981": {
      "shots": 4305,
      "goals": 265,
      "xg": 304.601,
      "gsax": 39.601,
      "impactPerShot": 0.008328,
      "team": "STL"
    },
    "8480992": {
      "shots": 387,
      "goals": 39,
      "xg": 28.356,
      "gsax": -10.644,
      "impactPerShot": -0.012717,
      "team": "SJS"
    },
    "8481020": {
      "shots": 2920,
      "goals": 192,
      "xg": 210.707,
      "gsax": 18.707,
      "impactPerShot": 0.005551,
      "team": "NSH"
    },
    "8481031": {
      "shots": 362,
      "goals": 27,
      "xg": 26.436,
      "gsax": -0.564,
      "impactPerShot": -0.000694,
      "team": "COL"
    },
    "8481033": {
      "shots": 2079,
      "goals": 142,
      "xg": 147.067,
      "gsax": 5.067,
      "impactPerShot": 0.002003,
      "team": "VGK"
    },
    "8481035": {
      "shots": 4845,
      "goals": 379,
      "xg": 346.516,
      "gsax": -32.484,
      "impactPerShot": -0.006135,
      "team": "PHI"
    },
    "8481519": {
      "shots": 4018,
      "goals": 268,
      "xg": 294.285,
      "gsax": 26.285,
      "impactPerShot": 0.005883,
      "team": "CHI"
    },
    "8481529": {
      "shots": 216,
      "goals": 13,
      "xg": 14.886,
      "gsax": 1.886,
      "impactPerShot": 0.002832,
      "team": "COL"
    },
    "8481544": {
      "shots": 285,
      "goals": 33,
      "xg": 20.21,
      "gsax": -12.79,
      "impactPerShot": -0.017402,
      "team": "OTT"
    },
    "8481551": {
      "shots": 673,
      "goals": 49,
      "xg": 47.587,
      "gsax": -1.413,
      "impactPerShot": -0.001258,
      "team": "BUF"
    },
    "8481611": {
      "shots": 3438,
      "goals": 237,
      "xg": 250.133,
      "gsax": 13.133,
      "impactPerShot": 0.003378,
      "team": "CAR"
    },
    "8481668": {
      "shots": 2094,
      "goals": 171,
      "xg": 151.441,
      "gsax": -19.559,
      "impactPerShot": -0.007688,
      "team": "PIT"
    },
    "8481692": {
      "shots": 5263,
      "goals": 355,
      "xg": 380.335,
      "gsax": 25.335,
      "impactPerShot": 0.004435,
      "team": "CGY"
    },
    "8481707": {
      "shots": 49,
      "goals": 1,
      "xg": 3.536,
      "gsax": 2.536,
      "impactPerShot": 0.005082,
      "team": "LAK"
    },
    "8482076": {
      "shots": 1162,
      "goals": 77,
      "xg": 83.532,
      "gsax": 6.532,
      "impactPerShot": 0.004052,
      "team": "NJD"
    },
    "8482123": {
      "shots": 172,
      "goals": 11,
      "xg": 12.727,
      "gsax": 1.727,
      "impactPerShot": 0.002776,
      "team": "CHI"
    },
    "8482137": {
      "shots": 2605,
      "goals": 199,
      "xg": 190.047,
      "gsax": -8.953,
      "impactPerShot": -0.002931,
      "team": "SJS"
    },
    "8482193": {
      "shots": 145,
      "goals": 7,
      "xg": 9.999,
      "gsax": 2.999,
      "impactPerShot": 0.005041,
      "team": "NYR"
    },
    "8482221": {
      "shots": 1321,
      "goals": 103,
      "xg": 97.556,
      "gsax": -5.444,
      "impactPerShot": -0.003074,
      "team": "BUF"
    },
    "8482411": {
      "shots": 255,
      "goals": 24,
      "xg": 18.321,
      "gsax": -5.679,
      "impactPerShot": -0.008055,
      "team": "WSH"
    },
    "8482445": {
      "shots": 1573,
      "goals": 107,
      "xg": 116.183,
      "gsax": 9.183,
      "impactPerShot": 0.00454,
      "team": "CGY"
    },
    "8482446": {
      "shots": 592,
      "goals": 49,
      "xg": 41.863,
      "gsax": -7.137,
      "impactPerShot": -0.006849,
      "team": "PIT"
    },
    "8482447": {
      "shots": 1095,
      "goals": 86,
      "xg": 77.244,
      "gsax": -8.756,
      "impactPerShot": -0.005667,
      "team": "OTT"
    },
    "8482487": {
      "shots": 2510,
      "goals": 164,
      "xg": 179.413,
      "gsax": 15.413,
      "impactPerShot": 0.005207,
      "team": "MTL"
    },
    "8482515": {
      "shots": 118,
      "goals": 11,
      "xg": 8.783,
      "gsax": -2.217,
      "impactPerShot": -0.003904,
      "team": "TOR"
    },
    "8482657": {
      "shots": 26,
      "goals": 3,
      "xg": 2.202,
      "gsax": -0.798,
      "impactPerShot": -0.001677,
      "team": "DET"
    },
    "8482661": {
      "shots": 1750,
      "goals": 112,
      "xg": 122.601,
      "gsax": 10.601,
      "impactPerShot": 0.004819,
      "team": "MIN"
    },
    "8482668": {
      "shots": 2,
      "goals": 1,
      "xg": 0.112,
      "gsax": -0.888,
      "impactPerShot": -0.001964,
      "team": "NYI"
    },
    "8482761": {
      "shots": 305,
      "goals": 24,
      "xg": 21.938,
      "gsax": -2.062,
      "impactPerShot": -0.002731,
      "team": "VGK"
    },
    "8482783": {
      "shots": 698,
      "goals": 62,
      "xg": 49.941,
      "gsax": -12.059,
      "impactPerShot": -0.010505,
      "team": "PHI"
    },
    "8482821": {
      "shots": 4167,
      "goals": 330,
      "xg": 305.699,
      "gsax": -24.301,
      "impactPerShot": -0.005263,
      "team": "CHI"
    },
    "8482949": {
      "shots": 44,
      "goals": 1,
      "xg": 3.396,
      "gsax": 2.396,
      "impactPerShot": 0.00485,
      "team": "CGY"
    },
    "8482982": {
      "shots": 3381,
      "goals": 201,
      "xg": 238.219,
      "gsax": 37.219,
      "impactPerShot": 0.009715,
      "team": "CBJ"
    },
    "8483114": {
      "shots": 95,
      "goals": 8,
      "xg": 6.615,
      "gsax": -1.385,
      "impactPerShot": -0.002542,
      "team": "WPG"
    },
    "8483530": {
      "shots": 235,
      "goals": 18,
      "xg": 16.875,
      "gsax": -1.125,
      "impactPerShot": -0.001642,
      "team": "UTA"
    },
    "8483532": {
      "shots": 217,
      "goals": 13,
      "xg": 15.244,
      "gsax": 2.244,
      "impactPerShot": 0.003365,
      "team": "WSH"
    },
    "8483548": {
      "shots": 1361,
      "goals": 100,
      "xg": 103.461,
      "gsax": 3.461,
      "impactPerShot": 0.001911,
      "team": "CAR"
    },
    "8483575": {
      "shots": 35,
      "goals": 0,
      "xg": 2.093,
      "gsax": 2.093,
      "impactPerShot": 0.004315,
      "team": "DAL"
    },
    "8483668": {
      "shots": 151,
      "goals": 11,
      "xg": 10.301,
      "gsax": -0.699,
      "impactPerShot": -0.001164,
      "team": "SEA"
    },
    "8483703": {
      "shots": 194,
      "goals": 12,
      "xg": 13.277,
      "gsax": 1.277,
      "impactPerShot": 0.001983,
      "team": "PIT"
    },
    "8483710": {
      "shots": 1105,
      "goals": 70,
      "xg": 78.899,
      "gsax": 8.899,
      "impactPerShot": 0.005723,
      "team": "TOR"
    },
    "8483746": {
      "shots": 19,
      "goals": 3,
      "xg": 1.35,
      "gsax": -1.65,
      "impactPerShot": -0.003519,
      "team": "ANA"
    },
    "8484170": {
      "shots": 678,
      "goals": 43,
      "xg": 50.801,
      "gsax": 7.801,
      "impactPerShot": 0.006916,
      "team": "MTL"
    },
    "8484268": {
      "shots": 946,
      "goals": 74,
      "xg": 69.454,
      "gsax": -4.546,
      "impactPerShot": -0.003256,
      "team": "VAN"
    },
    "8484293": {
      "shots": 10,
      "goals": 1,
      "xg": 0.852,
      "gsax": -0.148,
      "impactPerShot": -0.000322,
      "team": "CAR"
    },
    "8484312": {
      "shots": 384,
      "goals": 28,
      "xg": 26.616,
      "gsax": -1.384,
      "impactPerShot": -0.00166,
      "team": "SJS"
    },
    "8484910": {
      "shots": 70,
      "goals": 2,
      "xg": 4.954,
      "gsax": 2.954,
      "impactPerShot": 0.00568,
      "team": "SEA"
    }
  },
  "validation": {
    "incumbent": {
      "n": 2624,
      "marginMae": 2.1783,
      "totalMae": 1.9119,
      "homeGoalsMae": 1.4394,
      "awayGoalsMae": 1.4024,
      "winnerAccuracy": 0.5633,
      "brier": 0.24213
    },
    "challenger": {
      "n": 2624,
      "marginMae": 2.1482,
      "totalMae": 1.868,
      "homeGoalsMae": 1.406,
      "awayGoalsMae": 1.3645,
      "winnerAccuracy": 0.5617,
      "brier": 0.24117
    },
    "comparison": {
      "wins": {
        "margin": true,
        "total": true,
        "winner": false,
        "brier": true
      },
      "winCount": 3,
      "marginDelta": -0.0301,
      "totalDelta": -0.0439,
      "winnerDelta": -0.0016,
      "brierDelta": -0.00096,
      "beatsIncumbent": true
    }
  },
  "promotion": {
    "historicalPromotionEligible": true,
    "promotedToResearchBoard": true,
    "canQualify": false,
    "canAuthorizeWager": false
  }
});
