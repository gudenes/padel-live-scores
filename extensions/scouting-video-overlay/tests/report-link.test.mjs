import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adminReportUrl} from '../report-link.mjs';
test('admin report uses current match, supports private matches and keeps IDs inside the route',()=>{
 assert.equal(adminReportUrl(null),null);
 assert.equal(adminReportUrl({id:'match'}),'https://admin.padelnachos.com/scouting/match/report');
 assert.equal(adminReportUrl({id:'private',kind:'manual'}),'https://admin.padelnachos.com/scouting/manual/private/report');
 assert.equal(adminReportUrl({id:'../?redirect=https://other.test'}),'https://admin.padelnachos.com/scouting/..%2F%3Fredirect%3Dhttps%3A%2F%2Fother.test/report');
});
