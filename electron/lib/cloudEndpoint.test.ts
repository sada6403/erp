import {describe,it,expect} from 'vitest'
import {canonicalCloudBaseUrl} from './cloudEndpoint'
describe('legacy POS cloud endpoint compatibility',()=>{
 it('moves the exact legacy direct endpoint to the existing HTTPS API',()=>{expect(canonicalCloudBaseUrl(' http://72.61.115.222:4001/ ')).toBe('https://posadmin.nfplantation.com')})
 it('preserves custom servers, ports and proxy paths',()=>{for(const url of ['http://other.example:4001','http://72.61.115.222:4002','http://72.61.115.222:4001/proxy'])expect(canonicalCloudBaseUrl(url)).toBe(url)})
 it('does not reroute URLs carrying credentials or query parameters',()=>{for(const url of ['http://test:test@72.61.115.222:4001','http://72.61.115.222:4001?tenant=example'])expect(canonicalCloudBaseUrl(url)).toBe(url)})
 it('is idempotent and handles empty configuration',()=>{expect(canonicalCloudBaseUrl(canonicalCloudBaseUrl('http://72.61.115.222:4001'))).toBe('https://posadmin.nfplantation.com');expect(canonicalCloudBaseUrl(undefined)).toBe('')})
})
