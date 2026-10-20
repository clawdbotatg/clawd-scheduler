// Calendar text shared by the browser and API calendar updaters.
export const TITLE_PREFIX = 'Slop.Computer: ';
export const normDay = (d) => {
  if (!d) return d;
  const M = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const hm = d.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})$/);
  return hm ? `${hm[3]}/${M[hm[1].toLowerCase()]}/${Number(hm[2])}` : d;
};
export const INTRO =
  '**SLOP.COMPUTER**\n' +
  'an onchain podcast for technical humans building with ai.\n' +
  '\n' +
  'when you connect it will ask you to start a video (or just audio) stream to chat in a live interactive "slop computer".';
