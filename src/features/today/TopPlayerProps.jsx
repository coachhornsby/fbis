import ExchangePlayerPropsPanel from "../playerProps/ExchangePlayerPropsPanel.jsx";
import "./topPlayerProps.css";
export default function TopPlayerProps({sportFilter="all",limit=5}) {
  return <ExchangePlayerPropsPanel sportFilter={sportFilter} compact limit={limit}/>;
}
