import ExchangePlayerPropsPanel from "../playerProps/ExchangePlayerPropsPanel.jsx";
import "./topPlayerProps.css";
export default function TopPlayerProps({sportFilter="all",limit=5,board,date}) {
  return <ExchangePlayerPropsPanel board={board} selectedDate={date} sportFilter={sportFilter} compact limit={limit}/>;
}
