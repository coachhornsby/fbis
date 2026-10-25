import test from "node:test";
import assert from "node:assert/strict";
import { collegeTeamDisplay } from "../src/lib/collegeTeamDisplay.js";

test("USC appears above Trojans", () => {
  assert.deepEqual(collegeTeamDisplay({school:"USC",fullName:"USC Trojans",nickname:"Trojans"},"cfb"),
    {school:"USC",mascot:"Trojans"});
});
test("multiword school and mascot remain complete", () => {
  assert.deepEqual(collegeTeamDisplay({school:"North Carolina",fullName:"North Carolina Tar Heels",nickname:"Tar Heels"},"cfb"),
    {school:"North Carolina",mascot:"Tar Heels"});
});
test("official full school beats registry abbreviations", () => {
  assert.deepEqual(collegeTeamDisplay({school:"San Diego St",fullName:"San Diego State Aztecs",nickname:"Aztecs"},"cfb"),
    {school:"San Diego State",mascot:"Aztecs"});
});
test("other sports preserve their labels", () => {
  assert.deepEqual(collegeTeamDisplay({school:"USC",fullName:"USC Trojans",nickname:"Trojans"},"nfl"),
    {school:"USC Trojans",mascot:null});
});
test("unverified nickname does not get guessed", () => {
  assert.deepEqual(collegeTeamDisplay({school:"Notre Dame",fullName:"Notre Dame Fighting Irish"},"cfb"),
    {school:"Notre Dame Fighting Irish",mascot:null});
});
test("raw ESPN school + nickname works for unresolved catalog schools", () => {
  assert.deepEqual(collegeTeamDisplay({school:"Hawaii",name:"Hawaii Rainbow Warriors",nickname:"Rainbow Warriors"},"cfb"),
    {school:"Hawaii",mascot:"Rainbow Warriors"});
});
test("college basketball uses the same identity presentation", () => {
  assert.deepEqual(collegeTeamDisplay({school:"Texas Tech",fullName:"Texas Tech Red Raiders",nickname:"Red Raiders"},"cbb"),
    {school:"Texas Tech",mascot:"Red Raiders"});
});

test("official full school and mascot names are never abbreviated", () => {
  assert.deepEqual(
    collegeTeamDisplay({school:"San Diego St",fullName:"San Diego State Aztecs",nickname:"Aztecs"},"cfb"),
    {school:"San Diego State",mascot:"Aztecs"}
  );
  assert.deepEqual(
    collegeTeamDisplay({school:"Southern California",fullName:"University of Southern California Trojans",nickname:"Trojans"},"cfb"),
    {school:"University of Southern California",mascot:"Trojans"}
  );
  assert.deepEqual(
    collegeTeamDisplay({school:"North Carolina",fullName:"North Carolina Tar Heels",nickname:"Tar Heels"},"cfb"),
    {school:"North Carolina",mascot:"Tar Heels"}
  );
});
