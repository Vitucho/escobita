package controllers

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type ClientIdResolverFunc func(r *http.Request) int

type WebSocketsHandler struct {
	upgrader             websocket.Upgrader
	connsByClientId      map[int]*websocket.Conn
	mutex                sync.Mutex
	clientIdResolverFunc ClientIdResolverFunc
}

func NewWebSocketsHandler(clientIdResolverFunc ClientIdResolverFunc) WebSocketsHandler {
	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     func(r *http.Request) bool { return true },
	}
	connsByClientId := make(map[int]*websocket.Conn)
	return WebSocketsHandler{
		upgrader:             upgrader,
		connsByClientId:      connsByClientId,
		mutex:                sync.Mutex{},
		clientIdResolverFunc: clientIdResolverFunc,
	}
}

func (h *WebSocketsHandler) AdquireOrRetrieve(w http.ResponseWriter, r *http.Request) (*websocket.Conn, bool, error) {
	clientId := h.clientIdResolverFunc(r)
	h.mutex.Lock()
	defer h.mutex.Unlock()
	conn, exists := h.connsByClientId[clientId]
	if !exists { // server rules: at most one connection per http client (thus it is no multi tab compliant!)
		conn, err := h.upgrader.Upgrade(w, r, http.Header(map[string][]string{
			"created": []string{strconv.Itoa(int(time.Now().Unix()))},
		}))
		if err != nil {
			return nil, false, err
		}
		h.connsByClientId[clientId] = conn
		return conn, true, nil // adquired (is new)
	}
	return conn, false, nil // retrieved (is not new)
}

func (h *WebSocketsHandler) Release(w http.ResponseWriter, r *http.Request) error {
	clientId := h.clientIdResolverFunc(r)
	h.mutex.Lock()
	defer h.mutex.Unlock()
	conn, exists := h.connsByClientId[clientId]
	if !exists {
		return ConnectionDoesntExistErr
	}
	delete(h.connsByClientId, clientId)
	_1000 := []byte{3, 232} // 1000, honouring https://tools.ietf.org/html/rfc6455#page-36
	conn.WriteMessage(websocket.CloseMessage, _1000)
	return conn.Close()
}

var (
	ConnectionDoesntExistErr = errors.New("Connection doesn't exists")
	webSocketsHandler        = NewWebSocketsHandler(getWebPlayerId)
)

func AdquireWebSocket(w http.ResponseWriter, r *http.Request) {
	_, isNew, err := webSocketsHandler.AdquireOrRetrieve(w, r)
	if err != nil {
		log.Printf("Error getting web socket: %v\n", err)
		w.WriteHeader(http.StatusInternalServerError)
	}
	if !isNew {
		log.Printf("Web socket already adquired for client(id='%d')\n", getWebPlayerId(r))
		w.WriteHeader(http.StatusBadRequest)
	}
}

func ReleaseWebSocket(w http.ResponseWriter, r *http.Request) {
	err := webSocketsHandler.Release(w, r)
	if err != nil {
		log.Printf("Error releasing web socket: %v\n", err)
		w.WriteHeader(http.StatusInternalServerError) // DUE to: http: superfluous response.WriteHeader call from github.com/gorilla/handlers.(*responseLogger).WriteHeader (handlers.go:65)
	}
}
