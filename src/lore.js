/* =========================================================================
   THE LONG QUIET — lore.js
   Logs recovered from wrecks and beacons. Read in the order you find them,
   which is to say: out of order, like everything else out here.
   ========================================================================= */
(function (global) {
  'use strict';

  // The through-line. Found in sequence as the player recovers signals.
  // Each entry: id, from, title, body (array of lines).
  const CHAIN = [
    {
      id: 'v1', from: 'SURVEY VESSEL VELA', title: 'First transmission',
      body: [
        'If you are reading this, your beacon caught mine, which means you are',
        'alone out here too. I will not pretend that is a coincidence.',
        '',
        'They sent nine of us out along the arm. Nine ships, one direction each.',
        'The rule was simple: keep going until something is worth stopping for.',
        'I have been going eleven years.'
      ]
    },
    {
      id: 'v2', from: 'SURVEY VESSEL VELA', title: 'On silence',
      body: [
        'The quiet is not empty. That took me a long time to learn.',
        '',
        'It has texture. A dead star hums differently than a young one.',
        'A world with weather sounds nothing like a world without.',
        'You start hearing the difference around year three.',
        '',
        'You start talking back around year four. Do not worry about it.'
      ]
    },
    {
      id: 'v3', from: 'SURVEY VESSEL VELA', title: 'The thing at the centre',
      body: [
        'Every arm I have crossed, the instruments lean the same way.',
        'Inward. Toward the core.',
        '',
        'There is a mass there that does not make sense as a star. Four million',
        'suns held in a space you could cross in an afternoon. Light goes in.',
        'Nothing comes back to tell us what it saw.',
        '',
        'I have decided that is a question, and I have decided to answer it.'
      ]
    },
    {
      id: 'v4', from: 'SURVEY VESSEL VELA', title: 'What I left behind',
      body: [
        'Someone asked me, before launch, what I would miss.',
        'I said weather. I meant company. I said weather because it was easier',
        'to say in a room full of people who were staying.',
        '',
        'Eleven years. I have logged four thousand worlds and named none of them',
        'after anyone. That was not an oversight.'
      ]
    },
    {
      id: 'v5', from: 'SURVEY VESSEL VELA', title: 'Approach',
      body: [
        'Close now. The accretion disk is bright enough to read by.',
        '',
        'From here the light bends around the shadow so the far side of the disk',
        'appears above and below it at once. A halo made of the same fire,',
        'seen twice, from a direction that should not exist.',
        '',
        'I am going to fly the photon ring. If I am wrong about the margins,',
        'this is the last thing I send. If I am right, I will send one more.'
      ]
    },
    {
      id: 'v6', from: 'UNKNOWN — CARRIER LOST', title: 'The last one',
      body: [
        'I was right about the margins.',
        '',
        'Time runs slow this close. Your clock and my clock stopped agreeing',
        'somewhere back in the disk. By your reckoning this message is older',
        'than your ship. By mine I sent it a moment ago.',
        '',
        'It is not a hole. It is a horizon. Everything falls toward it and',
        'nothing is destroyed on the way — it is simply no longer news.',
        '',
        'Come see. Bring your own light. There is none out here to borrow.'
      ]
    }
  ];

  // Ambient finds — flavour, scattered through the arm in any order.
  const DRIFT = [
    { from: 'PROBE 12-KESTREL', title: 'Automated', body: [
      'Mission clock exceeded design life by 340 years.',
      'Power: 3%. Instruments: nominal. Still counting.',
      'Nobody has acknowledged a transmission in 2,190 cycles.',
      'Transmitting anyway. That is what I am for.' ] },
    { from: 'COLONY BARGE ASHFALL', title: 'Manifest, partial', body: [
      'Four thousand sleepers. Destination: unlisted.',
      'Navigation failed in the second decade. Life support held.',
      'They are still asleep. They are still going somewhere.',
      'Please do not wake them to tell them where.' ] },
    { from: 'UNMARKED HULL', title: 'Scratched into the bulkhead', body: [
      'IF YOU FOUND THIS YOU ARE FURTHER OUT THAN WE GOT',
      'GOOD',
      'KEEP GOING' ] },
    { from: 'RELAY STATION OKUN', title: 'Final entry', body: [
      'The relay was built to bounce messages home along the arm.',
      'In sixty years of operation it carried eleven thousand transmissions.',
      'Nine thousand of them were people saying they had arrived somewhere',
      'and it was beautiful and there was nobody to show it to.' ] },
    { from: 'DERELICT — NAME BURNED OFF', title: 'Log fragment', body: [
      'We stopped counting the jumps and started counting the good ones.',
      'A ringed world with two shadows. An ocean with no shore.',
      'A nebula that took a week to cross and lit the cabin green the whole way.',
      'Seventeen good ones. That was a life. I would take it again.' ] },
    { from: 'ESCAPE POD — EMPTY', title: 'Recorder', body: [
      'Ejection was automatic. I did not choose it.',
      'The ship is out there somewhere, still on course, still surveying,',
      'still doing the job without me.',
      'I hope it finds something. I hope it knows to stop and look.' ] },
    { from: 'BEACON — DRIFTING', title: 'Loop, repeating', body: [
      'This is a marker, not a distress call.',
      'A world here was worth stopping for. It has no name and I did not give it one.',
      'Names are for things you intend to come back to.' ] },
    { from: 'SURVEY DRONE 7', title: 'Observation', body: [
      'Recorded 41 sunrises from low orbit before power loss.',
      'No two identical. Attaching all 41.',
      'Attachment corrupted. Attaching description instead: they were orange,',
      'and then they were not.' ] }
  ];

  // Short one-liners that surface as ambient thoughts during long flights.
  const THOUGHTS = [
    'The hull ticks as it cools. That is the only sound for light-hours.',
    'Nothing out here is waiting for you. That is not the same as being unwelcome.',
    'You have not spoken aloud in some time. The instruments do not mind.',
    'Somewhere behind you, the light you left is still arriving.',
    'A star ahead. Someone, somewhere, has probably wished on it.',
    'The distances are not empty. They are just very patient.',
    'You could stop here. You could stop anywhere. You keep going.',
    'Old habit: you check the long-range scope before sleeping. Nothing. Good.',
    'The dust on the canopy is older than the world you were born on.',
    'You are the furthest human thing from home in this direction. For now.'
  ];

  function chainEntry(index) { return CHAIN[Math.min(index, CHAIN.length - 1)]; }
  function chainLength() { return CHAIN.length; }
  function driftEntry(rng) { return DRIFT[Math.floor(rng.next() * DRIFT.length) % DRIFT.length]; }
  function thought(rng) { return THOUGHTS[Math.floor(rng.next() * THOUGHTS.length) % THOUGHTS.length]; }

  global.LORE = { CHAIN, DRIFT, THOUGHTS, chainEntry, chainLength, driftEntry, thought };
})(window);
