# ZhaJinHua Scoring Mode Design

## Goals
- Add a ZhaJinHua mode that uses chips/pot and turn-based actions without exposing cards.
- Keep the UI simple and defaults safe (auto-advance on, minimal required inputs).
- Reuse the existing room/membership/sync mechanics so new games can be added later.

## Architecture
- Split logic into a room core and a game rules module.
- Room core owns: members, seats, stack balances, rebuy, synchronization, host permissions, and common state fields (roundId, turnIndex, dealerIndex, pot, settled, autoStage).
- Rules module owns: game-specific validation and state transitions (actions, round flow, showdown, and restrictions).
- Introduce `gameType` (`texas`, `zhajinhua`) and `gameRules` on room documents. ZhaJinHua rules are stored under `gameRules.zjh`.
- UI is composed of a shared room shell with a game panel that swaps by `gameType`.

## ZhaJinHua Rules (configurable)
- baseBet (required), buyIn (required), maxSeats (<= 12), maxRounds (default 20), minSeeRound (default 3).
- compareAllowedAfter (default 3), special235 = true, rebuyLimit = buyIn.
- First dealer is seat 1; subsequent dealer is previous hand winner; action proceeds clockwise and dealer acts first.
- Bets are entered using dark bet units; seen players pay 2x.
- Raise minimum is `currentCall + baseBet` in dark bet units.
- Compare costs the initiator their current call amount; blind players must see first.
- Round cap triggers forced showdown with host selecting winners; ties split the pot.

## Data Model
- Room: gameType, gameRules, zjhRoundCount, zjhStage.
- Player: seen, handBet, actedRound, status (active/fold/allin/out).
- Core fields remain: pot, turnIndex, dealerIndex, roundId, settled, autoStage.

## UI Flow
- Create room: base bet, buy-in, max seats, max rounds, min see round.
- Table view: only show valid actions per turn (blind follow/raise/see/fold, seen follow/raise/compare, all-in).
- Forced showdown: host selects winner(s), with split option.
- Between hands: allow rebuy (<= buy-in), seat reorder, and start next hand.

## Error Handling
- Enforce expected state (turnIndex, roundId, settled) to avoid stale updates.
- Validate action permissions (turn owner, min see round, compare availability, sufficient stack).
- Ensure caps (max rounds, max seats, rebuy limit).

## Testing
- Unit tests for rule transitions (betting, compare, forced showdown).
- Integration tests for room actions, including rebuy and seat reorder in ZhaJinHua mode.
