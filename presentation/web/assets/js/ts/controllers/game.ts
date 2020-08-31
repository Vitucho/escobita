/// <reference path='../app.ts' />
/// <reference path='../services/services.ts' />

module Game {

  // BEGIN : move to common.js
  function isNumeric(s: any): boolean {
    return !isNaN(parseFloat(s)) && isFinite(s); // based from: http://stackoverflow.com/a/6449623
  }

  function unixToReadableClock(unix: number): string {
    return formatUnixTimestamp(unix,"HH:mm")
  }

  function unixToReadableDay(unix: number): string {
    return formatUnixTimestamp(unix,"DD/MM/YYYY")
  }

  function unixToReadableDate(unix: number): string {
    return formatUnixTimestamp(unix,"DD/MM/YYYY HH:mm")
  }

  function unixToReadableDateVerbose(unix: number): string {
    return formatUnixTimestamp(unix,"dddd DD/MM/YYYY [a las] HH:mm")
  }


  function formatUnixTimestamp(unix: number, layout:string) {
    if (isNumeric(unix)) {
      return moment.unix(unix).format(layout);
    } else {
      console.warn(`Unix timestamp value(=${unix}) is not a number`)
      return '';
    }
  }

  namespace UIMessages {

    export const baseFontSize = 12;
    const maxFontSize = 24;
    const fontSizeAmplitude = baseFontSize - maxFontSize;

    function determineFontSize(position: number) {
        const size = baseFontSize + (fontSizeAmplitude) / position; // B + M/X (Homográfica desplazada)
        return size;
    }

    export interface FontSizeByPlayerName extends _.Dictionary<number> {
      [name:string]: number;
    }

    export function calculateFontSizeByPlayerName(positionsByPlayerName: Matchs.Rules.PositionByPlayerName) : FontSizeByPlayerName {
      return _.reduce(positionsByPlayerName,(acc, position, name) => {
        acc[name] = determineFontSize(position + 1) // position starts at 0
        return acc
      },<FontSizeByPlayerName>{})
    }
  }

  // END :  move to util.js
  class Controller {

    public game: Games.Game; // the current game
    public player: Players.Player; // the client player
    public isPlayerTurn: boolean;
    private refreshGameInterval: ng.IPromise<any>; // "handler" to the update interval using for refresh game status while is not the client player's turn
    public currentTurnPlayer: Players.Player; // the player that acts in the current turn
    public messages: Messages.Message[]; // all from the server related to this game
    public isBoardCardSelectedById: _.Dictionary<boolean>;
    public selectedHandCard: Api.Card;

    public message: Messages.Message; // buffer for user input
    public disableSendMessageBtn: boolean = false; // avoids multiples clicks!
    public isChatEnabled: boolean = false;
    private updateChatInterval: ng.IPromise<any>; // "handler" to the update interval using to update the chat
    private currentFontSizeByPlayerName: UIMessages.FontSizeByPlayerName; // funny font size to use by player name
    private currentPositionByPlayerName: Matchs.Rules.PositionByPlayerName; // positions by player name

    public isMatchInProgress: boolean = false;
    public currentMatchStats: Api.ScoreSummaryByPlayerName;

    public players: Players.Player[];
    public playersById: Util.EntityById<Players.Player>;

    private lastUpdateUnixTimestamp: number = undefined;

    public formatUnixTimestamp = unixToReadableClock
    public translateSuit = Cards.Suits.translate

    constructor(private $scope: ng.IScope, private $state: ng.ui.IStateService, private gamesService: Games.Service, private playersService: Players.Service,
      private messagesService: Messages.Service, private $interval: ng.IIntervalService, private $timeout: ng.ITimeoutService,
      private $q: ng.IQService) {
      this.game = $state.params["game"]
      this.player = $state.params["player"]

      this.$scope.$watch(() => {
        if (_.isUndefined(this.game.currentMatch)) {
          return undefined
        }
        return this.game.currentMatch.currentRound.currentTurnPlayer
      }, (currentTurnPlayer,previousTurnPlayer) => {
        if (!_.isUndefined(currentTurnPlayer)) {
          this.currentTurnPlayer = currentTurnPlayer;
          this.isPlayerTurn = Rounds.isPlayerTurn(this.game.currentMatch.currentRound,this.player)// dev pnote: was using this.currentTurnPlayer instead of this.player >( !!! afff
        }
      })

      this.$scope.$watch(() => {
        return this.isChatEnabled
      }, (isEnabled) => {
        if (_.isUndefined(isEnabled)) {
          return
        }
        if (isEnabled) {
          this.updateChatInterval = this.$interval(() => {
            this.updatePlayers()
              .then(() => this.updateGameMessages ())
              .then(() => {
                console.log("Updated players and messages OK!")
                if (!_.isUndefined(this.lastUpdateUnixTimestamp)) {
                  const now = 	Math.floor(new Date().getTime()/1000.0)
                  console.log("demora aproximada ", now - this.lastUpdateUnixTimestamp)
                }
                this.lastUpdateUnixTimestamp = 	Math.floor(new Date().getTime()/1000.0) // USE MOMENTjs
              })
          },2000)
        } else if (!_.isUndefined(this.updateChatInterval)) {
          this.$interval.cancel(this.updateChatInterval)
          this.updateChatInterval = undefined;
        }
      })

      this.$scope.$watch(() => {
        return this.isPlayerTurn
      }, (isPlayerTurn) => {
        if (_.isUndefined(isPlayerTurn)) {
          return
        }
        if (!isPlayerTurn) { // auto refresh when is not player turn
          this.refreshGameInterval = this.$interval(() => {
            return this.refreshGame()
          },2000)
        } else if (!_.isUndefined(this.refreshGameInterval)) {
          this.$interval.cancel(this.refreshGameInterval)
          this.refreshGameInterval = undefined;
        }
      })
    }

    public updateGameMessages() {
      return this.messagesService.getMessagesByGame(this.game.id).then((messages) => {
        this.messages = messages;
        return messages;
      })
    }

    private updatePlayers() {
      return this.playersService.getPlayers().then((players) => {
        this.playersById = Util.toMapById(players)
        this.players = players;
        return players
      })
    }

    public sendMessage(text: string) {
      if (this.disableSendMessageBtn) {
        return
      }
      const message = Messages.newMessage(this.game.id, this.player.id, text)
      this.messagesService.createMessage(message)
      this.disableSendMessageBtn = true;
      this.$timeout(() => {
        this.disableSendMessageBtn = false;
      }, 2000)
    }

    public startGame(game: Games.Game, players: Players.Player[]) {
      // TODO : Use loading flag for UI
        return this.gamesService.startGame(game).then((game) => {
          this.game = game;
          this.isMatchInProgress = true;
          return game
        })
    }

    public hasValidTakeAction() {
      if (_.isEmpty(this.selectedHandCard)) {
        return false
      }
      const selectedBoardCards = this.getSelectedBoardCards()
      if (_.isEmpty(selectedBoardCards)) {
        return false
      }
      return Matchs.Rules.canTakeCards(this.selectedHandCard,selectedBoardCards)
    }

    public performTakeAction() {
      const selectedBoardCards = this.getSelectedBoardCards()
      const takeAction = Matchs.createTakeAction(this.player,selectedBoardCards,this.selectedHandCard)
      this.gamesService.performTakeAction(this.game,takeAction).then((data) => {
        this.game = data.game
        if (data.action.isEscobita) {
          alert("Escobita jopu!!")
        }
      }).finally(() => {
        this.isBoardCardSelectedById = {}
      })
    }

    private getSelectedBoardCards() {
       return _.reduce(this.isBoardCardSelectedById,(acc,selected,id) => {
        if (selected) {
          const card = _.find(this.game.currentMatch.matchCards.board,(boardCard) => boardCard.id === +id)
          const isNotInBoard = _.isUndefined(card)
          if (isNotInBoard) {
            console.warn("suspicious things, programmer must check something...")
          } else {
            acc.push(card)
          }
        }
        return acc
      },<Api.Card[]>[])
    }

    public hasValidDropAction() {
      return !_.isEmpty(this.selectedHandCard)
    }

    public performDropAction() {
      const selectedBoardCards = this.getSelectedBoardCards()
      const dropAction = Matchs.createDropAction(this.player,this.selectedHandCard)
      this.gamesService.performDropAction(this.game,dropAction).then((data) => {
        this.game = data.game
      }).finally(() => {
        this.selectedHandCard = undefined
      })
    }

    public refreshGame() {
      return this.gamesService.getGameById(this.game.id).then((game) => {
        this.game = game;
        this.isMatchInProgress = Games.hasMatchInProgress(game)
        if (this.isMatchInProgress) {
          this.gamesService.calculateStatsByGameId(this.game.id).then((stats) => {
            this.currentMatchStats = stats;
            this.currentPositionByPlayerName = Matchs.Rules.calculatePositionByPlayerName(stats)
            this.currentFontSizeByPlayerName = UIMessages.calculateFontSizeByPlayerName(this.currentPositionByPlayerName)
          })
        }
        return game
      })
    }

    public getFontSize(player: Players.Player) {
      if (_.isEmpty(this.currentFontSizeByPlayerName)) {
        return UIMessages.baseFontSize;
      } else {
        return this.currentFontSizeByPlayerName[player.name]
      }
    }


  }

  escobita.controller('GameController', ['$scope','$state', 'GamesService', 'PlayersService', 'MessagesService', '$interval', '$timeout', '$q', Controller]);
}

// TODO: place in separate file

namespace Util {


  export interface EntityById<T> extends _.Dictionary<T>  {
    [id: number] : T
  }

  /** An identifiable entity has an numeric id that identifies unequivocally within a context. */
  export interface Identificable {
    id?: number; // it is optional due to have api model objects with nullable id, as they first are created in the client and then saved on the server granting an id, basically for avoiding this -> `Property 'id' is optional in type 'Player' but required in type 'Identificable'`
  }

  /** Generates a map by id of the given collection of identificables. */
  export function toMapById<T extends Identificable>(entites: T[]) : EntityById<T> {
    return _.indexBy(entites, 'id');
  }

  /** Generates a map by id of the given collection of elements whose id is extracted using the correspondant method */
  export function toMapByIdUsingGetter<T>(list: T[], idGetterFunc: (elem:T) => number) : EntityById<T> {
    return list.reduce((map: any, elem: T) => {
      map[idGetterFunc(elem)] = elem
      return map;
    }, {});
  }
}