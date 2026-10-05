-- SOCCER-FBIS-v3.1 PitchAPI feature expansion from full API reference.
-- Compact derived features only; large heatmap/network payloads remain optional raw research artifacts.

ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_npxg REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_npxg REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_xg_open_play REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_xg_open_play REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_xg_set_play REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_xg_set_play REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_xg_per_shot REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_xg_per_shot REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_pass_accuracy REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_pass_accuracy REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_passes_into_box REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_passes_into_box REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_key_passes REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_key_passes REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_through_balls REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_through_balls REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_progressive_pass_distance REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_progressive_pass_distance REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_carries_into_final_third REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_carries_into_final_third REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_carries_into_box REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_carries_into_box REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_avg_defensive_action_x REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_avg_defensive_action_x REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_buildup_attacks REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_buildup_attacks REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_direct_attacks REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_direct_attacks REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN home_network_centralization REAL;
ALTER TABLE soccer_pitchapi_match_features ADD COLUMN away_network_centralization REAL;

ALTER TABLE soccer_pitchapi_player_match ADD COLUMN vaep_offensive REAL;
ALTER TABLE soccer_pitchapi_player_match ADD COLUMN vaep_defensive REAL;
ALTER TABLE soccer_pitchapi_player_match ADD COLUMN pv_total REAL;
ALTER TABLE soccer_pitchapi_player_match ADD COLUMN goals REAL;
ALTER TABLE soccer_pitchapi_player_match ADD COLUMN assists REAL;
ALTER TABLE soccer_pitchapi_player_match ADD COLUMN expected_goals REAL;
ALTER TABLE soccer_pitchapi_player_match ADD COLUMN expected_assists REAL;
ALTER TABLE soccer_pitchapi_player_match ADD COLUMN saves REAL;
ALTER TABLE soccer_pitchapi_player_match ADD COLUMN claims REAL;
ALTER TABLE soccer_pitchapi_player_match ADD COLUMN claims_won REAL;
ALTER TABLE soccer_pitchapi_player_match ADD COLUMN sweeper_actions REAL;
ALTER TABLE soccer_pitchapi_player_match ADD COLUMN distribution_accuracy REAL;
ALTER TABLE soccer_pitchapi_player_match ADD COLUMN avg_pass_length REAL;

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0058_soccer_pitchapi_full_reference',datetime('now'));
