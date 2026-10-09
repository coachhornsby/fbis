// Match parseInt(String(id || '0').slice(0, 8), 16), including partial,
// signed and 0x-prefixed legacy IDs. The recursion consumes at most 8 chars
// per candidate; it never materializes snapshot JSON for other shards.
const jsWhitespace = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
const legacyParse = `(WITH RECURSIVE
  trimmed(s) AS (SELECT lower(ltrim(substr(COALESCE(NULLIF(id,''),'0'),1,8), '${jsWhitespace}'))),
  signed(s,sign) AS (SELECT CASE WHEN substr(s,1,1) IN ('+','-') THEN substr(s,2) ELSE s END,
    CASE WHEN substr(s,1,1)='-' THEN -1 ELSE 1 END FROM trimmed),
  digits(s,sign) AS (SELECT CASE WHEN substr(s,1,2)='0x' THEN substr(s,3) ELSE s END,sign FROM signed),
  parsed(s,sign,n,used) AS (
    SELECT s,sign,0,0 FROM digits
    UNION ALL
    SELECT substr(s,2),sign,n*16+instr('0123456789abcdef',substr(s,1,1))-1,used+1
    FROM parsed WHERE length(s)>0 AND instr('0123456789abcdef',substr(s,1,1))>0)
  SELECT CASE WHEN used>0 THEN sign*n ELSE NULL END FROM parsed ORDER BY used DESC LIMIT 1)`;

// Canonical SHA prefixes need no recursive rows. Keep the legacy parser only
// for irregular IDs so normal acquisition does not amplify D1 billed reads.
const hexPrefix = Array.from({length:8},(_,i)=>
  `(instr('0123456789abcdef',lower(substr(id,${i+1},1)))-1)*${16**(7-i)}`).join('+');
export const MLB_SETTLEMENT_SHARD_VALUE = `(CASE
  WHEN length(substr(id,1,8))=8 AND substr(id,1,8) NOT GLOB '*[^0-9a-fA-F]*'
  THEN ${hexPrefix} ELSE ${legacyParse} END)`;

// Only fields read by settlement/grading/rejection code. Frozen state and
// projection snapshots remain untouched in storage, not copied into memory.
export const MLB_SETTLEMENT_ROWS_SQL = `SELECT id,event_id,player_id,player_name,market,
  candidate_side,market_line,market_json,market_source,sportsbook,duplicate_key,market_observed_at
  FROM mlb_prop_prospective_evidence
  WHERE event_id=? AND settled_at IS NULL AND temporal_integrity=1
    AND (?<=1 OR mod(${MLB_SETTLEMENT_SHARD_VALUE}, ?)=?)`;
