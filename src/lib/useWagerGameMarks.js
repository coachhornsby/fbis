import {useEffect,useState} from 'react';
import {readWagerMarks,wagerGameKey,WAGER_MARKS_KEY} from './gameCardOrder.js';
export function useWagerGameMarks(){
 const [marked,setMarked]=useState(()=>new Set()),[message,setMessage]=useState('');
 useEffect(()=>{const load=()=>setMarked(readWagerMarks(window.localStorage));try{load();}catch{}const listener=e=>{if(e.key===WAGER_MARKS_KEY||e.key===null)try{load();}catch{}};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);},[]);
 const toggle=game=>{const key=wagerGameKey(game);if(!key)return;const next=new Set(marked);if(next.has(key))next.delete(key);else{if(next.size>=500){setMessage('Remove an older wager mark before adding another.');return;}next.add(key);}setMarked(next);try{window.localStorage.setItem(WAGER_MARKS_KEY,JSON.stringify([...next]));setMessage('');}catch{setMessage('Wager marks are available in this tab only; browser storage is unavailable.');}};
 return {marked,toggle,message};
}
