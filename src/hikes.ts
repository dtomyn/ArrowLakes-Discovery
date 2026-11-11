// A short, hand-picked guide to the Arrow Lakes' best-known hikes, waterfalls, lookouts and hot springs.
// Positions come from OpenStreetMap (waterfalls, viewpoints, hot springs and named trails in osm.json,
// checked 2026-11-11); trail lengths are summed from the mapped OSM trails each entry matches, so they
// track the data.

export type GuideKind = 'hike' | 'falls' | 'lookout' | 'springs';

export type GuideStop = {
  id: string;
  name: string;
  kind: GuideKind;
  lon: number;
  lat: number;
  /** OSM trail names that belong to this stop (they become one route, with a profile and a 3D flight) */
  trails?: RegExp;
  /** Wikimedia Commons file names that show this stop (the pipeline picks a geotagged photo nearby) */
  photo?: RegExp;
  effort: 'Easy' | 'Moderate' | 'Moderate to hard';
  near: string;
  note: string;
};

export const GUIDE_KIND: Record<GuideKind, { label: string; color: string }> = {
  hike: { label: 'Hike', color: '#34d399' },
  falls: { label: 'Waterfall', color: '#8be3ff' },
  lookout: { label: 'Lookout', color: '#c5e86c' },
  springs: { label: 'Hot spring', color: '#ffa98a' },
};

/** North to south, the order of the valley road trip. */
export const GUIDE: GuideStop[] = [
  {
    id: 'begbie-falls', photo: /begbie\W*falls/i, name: 'Begbie Falls', kind: 'falls', lon: -118.1891, lat: 50.9332,
    effort: 'Easy', near: 'just south of Revelstoke',
    note: 'Begbie Creek drops through cedar forest a short walk from the road, on the slopes above the Columbia.',
  },
  {
    id: 'mount-cartier', photo: /cartier/i, name: 'Mount Cartier Trail', kind: 'hike', lon: -118.0897, lat: 50.9143, trails: /^Mount Cartier Trail$/i,
    effort: 'Moderate to hard', near: 'southeast of Revelstoke',
    note: 'A long, relentless climb out of the Columbia valley to alpine slopes, with the Monashees and Selkirks all around. A full day.',
  },
  {
    id: 'sutherland-falls', photo: /sutherland\W*falls|blanket\W*creek/i, name: 'Sutherland Falls', kind: 'falls', lon: -118.0904, lat: 50.8335,
    effort: 'Easy', near: 'Blanket Creek Provincial Park, south of Revelstoke',
    note: 'A short forest walk from the campground leads to a waterfall pouring into a deep pool.',
  },
  {
    id: 'sproat', photo: /sproat/i, name: 'Sproat Mountain Lookout Trail', kind: 'hike', lon: -117.8977, lat: 50.7192, trails: /Sproat Mountain/i,
    effort: 'Moderate to hard', near: 'the north end of the Upper Arrow Lake',
    note: 'A steep climb to a lookout high above the head of the Upper Arrow Lake.',
  },
  {
    id: 'halfway', photo: /halfway\W*(river\W*)?hot\W*spring/i, name: 'Halfway Hot Springs', kind: 'springs', lon: -117.7861, lat: 50.5048,
    effort: 'Easy', near: 'up the Halfway River, north of Nakusp',
    note: 'Rustic, undeveloped pools beside the Halfway River, reached by a forest road and a short path. Bring everything out with you.',
  },
  {
    id: 'nakusp-hot-springs', photo: /nakusp\W*hot\W*spring|kuskanax/i, name: 'Nakusp Hot Springs & Kuskanax Creek', kind: 'springs', lon: -117.6854, lat: 50.2965, trails: /Kusk(a|u)n(a|u)x Creek/i,
    effort: 'Moderate', near: 'up the Kuskanax valley, northeast of Nakusp',
    note: 'Hot pools in the Kuskanax valley. The creekside trail follows the water through old cedar forest.',
  },
  {
    id: 'saddle', photo: /saddle\W*mountain/i, name: 'Saddle Mountain Lookout', kind: 'hike', lon: -117.8819, lat: 50.1541, trails: /Saddle Mountain/i,
    effort: 'Moderate to hard', near: 'south of Nakusp',
    note: 'A steep climb to a fire lookout high above the lakes, with views up and down the valley.',
  },
  {
    id: 'syringa', photo: /syringa/i, name: 'Syringa Provincial Park', kind: 'hike', lon: -117.8793, lat: 49.3485, trails: /^Syringa Trail$/i,
    effort: 'Easy', near: 'the south end of the Lower Arrow Lake',
    note: 'Dry pine bluffs and beaches on the Lower Arrow Lake, one of the warmest corners of the valley.',
  },
  {
    id: 'waldie', photo: /waldie/i, name: 'Waldie Island Trail', kind: 'hike', lon: -117.6555, lat: 49.3318, trails: /Waldie Island/i,
    effort: 'Easy', near: 'Robson',
    note: 'A flat walk along the Columbia’s north shore, good for birdwatching over the river.',
  },
  {
    id: 'zuckerberg', photo: /zuckerberg/i, name: 'Zuckerberg Island', kind: 'lookout', lon: -117.6565, lat: 49.3155,
    effort: 'Easy', near: 'downtown Castlegar',
    note: 'A small island heritage park where the Kootenay meets the Columbia, reached by a suspension footbridge.',
  },
  {
    id: 'brilliant', photo: /brilliant\W*(suspension|bridge|overlook)/i, name: 'Brilliant Overlook', kind: 'lookout', lon: -117.6032, lat: 49.3234, trails: /Brilliant Overlook/i,
    effort: 'Easy', near: 'Brilliant, east of Castlegar',
    note: 'A short trail to a lookout high above the Kootenay River at Brilliant, home of the suspension bridge the Doukhobor community built in 1913.',
  },
  {
    id: 'merry-creek', photo: /merry\W*creek/i, name: 'Merry Creek trails', kind: 'hike', lon: -117.6852, lat: 49.304, trails: /^Merry Creek Trail$/i,
    effort: 'Easy', near: 'south Castlegar',
    note: 'A web of forest trails on Castlegar’s south side, shared by walkers and mountain bikers.',
  },
];
