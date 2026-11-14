import { splitName, nameFontSize } from '../src/components/Shell';

describe('header name', () => {
  it('splits two words onto two lines', () => expect(splitName('Natural Plantation')).toEqual(['Natural', 'Plantation']));
  it('splits at the space nearest the middle', () => expect(splitName('Nature Farming Groups Ltd')).toEqual(['Nature Farming', 'Groups Ltd']));
  it('keeps one word on one line', () => expect(splitName('Plantation')).toEqual(['Plantation']));
  it('never goes below the minimum or above the maximum size', () => {
    expect(nameFontSize(['Plantation'], 10)).toBe(12);
    expect(nameFontSize(['Hi'], 500)).toBe(17);
  });
});
