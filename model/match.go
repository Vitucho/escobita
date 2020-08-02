package model

import (
	"fmt"
	"strings"
)

type Match struct {
	Players          []Player
	ActionsByPlayer  ActionsByPlayer
	MatchCards       MatchCards
	FirstPlayerIndex int
	RoundNumber      int
}

type ActionsByPlayer map[Player][]PlayerAction

type MatchCards struct {
	Board     Deck // the cards on the table that anyone can reclaim
	Left      Deck // the remaining cards to play in the rest of the match
	PerPlayer map[Player]PlayerMatchCards
}

type PlayerMatchCards struct {
	Taken Deck // the cards on the player has claimed
	Hand  Deck // the cards on the player has to play
}

func (m Match) String() string {
	playersDescription := make([]string, 0, len(m.Players))
	for _, player := range m.Players {
		cardsInHands := Deck(m.MatchCards.PerPlayer[player].Hand).String()
		cardsTaken := Deck(m.MatchCards.PerPlayer[player].Taken).String()
		playerDescription := fmt.Sprintf("%s\nCards taken:%v\nCards in hand:%v", player.Name, cardsTaken, cardsInHands)
		playersDescription = append(playersDescription, playerDescription)
	}
	joinedPlayersDescription := strings.Join(playersDescription, "\n")
	matchBoardCards := Deck(m.MatchCards.Board).String()
	matchLeftCards := Deck(m.MatchCards.Left).String()
	return fmt.Sprintf("Match, first player is %v and current round is %v,\nLeft cards:%v\nBoard cards: %v\nPlayers:\n%v", m.Players[m.FirstPlayerIndex], m.RoundNumber, matchLeftCards, matchBoardCards, joinedPlayersDescription)
}
