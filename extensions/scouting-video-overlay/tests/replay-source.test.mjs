import test from 'node:test';
import assert from 'node:assert/strict';
import {replaySource} from '../replay-source.mjs';
import {validateVideoState} from '../server-model.mjs';
import {defaults,validateSetup} from '../match.mjs';
test('canonical video link survives setup changes and server roundtrip',()=>{
 const setup=validateSetup({...defaults(),videoSourceUrl:'https://www.youtube.com/watch?v=iNRkrLDLkTk&t=120&tracking=example'});
 const saved=validateVideoState({version:1,setup,rallies:[],cancelled:[]});
 assert.equal(saved.setup.videoSourceUrl,'https://www.youtube.com/watch?v=iNRkrLDLkTk');
 assert.equal(validateVideoState(saved).setup.videoSourceUrl,saved.setup.videoSourceUrl);
});
test('supported YouTube forms normalize; unrelated or credential URLs are excluded',()=>{
 for(const url of ['https://youtu.be/iNRkrLDLkTk','https://www.youtube.com/live/iNRkrLDLkTk'])assert.equal(replaySource(url),'https://www.youtube.com/watch?v=iNRkrLDLkTk');
 for(const url of ['https://youtube.com.evil.test/watch?v=iNRkrLDLkTk','https://user:pass@youtube.com/watch?v=iNRkrLDLkTk','http://youtube.com/watch?v=iNRkrLDLkTk',null])assert.equal(replaySource(url),null);
});
