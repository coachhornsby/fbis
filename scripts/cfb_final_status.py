"""Final result contract. A numeric 0-0 does not establish completion."""
import pandas as pd

def final_mask(frame):
    if 'status' not in frame:
        raise ValueError('authoritative game status required; scores alone are insufficient')
    status=frame['status'].astype(str).str.upper().str.strip()
    return status.eq('STATUS_FINAL') & pd.to_numeric(frame['home_score'],errors='coerce').notna() & pd.to_numeric(frame['away_score'],errors='coerce').notna()
