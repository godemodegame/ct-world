export const NPCS = [
  {
    id: 'jessy',
    displayName: 'jessyfries',
    handle: '@jessyfries',
    verifiedIcon: '/assets/checkmark.svg.png',
    color: 0xff7aa8,
    position: { x: 5, z: -4 },
    questId: 'fries_for_jessy',
    model: '/assets/jessyfries/jessyfries.fbx',
    texture: '/assets/jessyfries/jessyfries_texture.jpg',
    avatar: '/assets/jessyfries/jessyfries_pfp.jpg',
    bio: 'Tweeting through hunger.',
  },
];

export const WALE_MOCA = {
  id: 'wale_moca',
  displayName: 'wale.moca 🐳',
  handle: '@wleswoosh',
  verifiedIcon: '/assets/checkmark.svg.png',
  model: '/assets/wale.moca/waleswoosh.fbx',
  texture: '/assets/wale.moca/waleswoosh_texture.jpg',
  avatar: '/assets/wale.moca/waleswoosh_pfp.jpg',
};

export const LOCATIONS = [
  {
    id: 'mcdonalds',
    displayName: "McDonald's",
    color: 0xd9281e,
    accentColor: 0xffc72c,
    position: { x: -8, z: 7 },
  },
];

export const QUESTS = {
  fries_for_jessy: {
    id: 'fries_for_jessy',
    title: 'Fries for jessyfries',
    itemId: 'fries',
    itemName: 'fries',
    giverId: 'jessy',
    shopId: 'mcdonalds',
    waitMs: 5 * 60 * 1000,
    posts: {
      start: 'not being dramatic but today does not count until fries happen',
      accepted: 'quest accepted. fries are now a matter of public interest',
      ordered: 'order placed. the timeline is waiting respectfully',
      pickedUp: 'bag secured. hot fries detected',
      complete: 'official statement: fries saved the timeline',
    },
  },
};
