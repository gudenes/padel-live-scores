import {videoPayload} from './server-model.mjs';
self.onmessage=({data})=>{try{self.postMessage({id:data.id,document:videoPayload(data.state)})}catch(error){self.postMessage({id:data.id,error:error.message})}};
