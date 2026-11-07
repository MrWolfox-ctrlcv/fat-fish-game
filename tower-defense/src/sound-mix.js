// Per-shot gain, bounded tail and shared concurrency prevent cannon stacks dominating the mix.
export const SAMPLE_MIX={
 cannon:{gain:.16,seconds:1.1,release:.25,group:'cannon',maxVoices:2},
 'side-cannon':{gain:.075,seconds:.38,release:.12,group:'cannon',maxVoices:2},
 'giant-cannon':{gain:.23,seconds:1.5,release:.3,group:'cannon',maxVoices:2},
 'giant-impact':{gain:.22,seconds:1.8,release:.45,group:'impact',maxVoices:2},
 splash:{gain:.22,seconds:.535,release:.08,group:'impact',maxVoices:3},
 laser:{gain:.2,seconds:1.6,release:.12,group:'laser',maxVoices:3}
};
export const mixFor=cue=>SAMPLE_MIX[cue]||{gain:.7,release:.035,group:cue,maxVoices:4};
