import {shots} from './shots';
const palette=['#428c91','#8574b6','#e7ad43','#e77e73','#659d65','#b58756','#678cba','#ad718b','#a0b836','#599caa','#956b55','#727ba9','#b18b43','#6f9982','#9379a0','#a28574','#718e9e','#929a80'];
export const shotColor=(key:string)=>!(key in shots)?'#a4aaa2':palette[Object.keys(shots).indexOf(key)%palette.length];
