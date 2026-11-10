import {it,expect} from 'vitest';
import {selectReviewSource,reviewSourceOffset} from '../review-source';
it('keeps broadcast available before upload is ready',()=>{expect(selectReviewSource('auto',{broadcast:true,uploaded:false,local:true})).toBe('broadcast')});
it('honors broadcast selection after upload',()=>{expect(selectReviewSource('broadcast',{broadcast:true,uploaded:true,local:true})).toBe('broadcast')});
it('defaults to a ready upload',()=>{expect(selectReviewSource('auto',{broadcast:true,uploaded:true,local:true})).toBe('uploaded')});
it('falls back when upload is unavailable',()=>{expect(selectReviewSource('uploaded',{broadcast:true,uploaded:false,local:false})).toBe('broadcast')});
it('keeps original broadcast timestamps independent',()=>{expect(reviewSourceOffset('broadcast',18881,18881,18883)).toBe(0);expect(reviewSourceOffset('uploaded',0,18881,18883)).toBe(18883);expect(reviewSourceOffset('local',18881,10)).toBe(18881)});
