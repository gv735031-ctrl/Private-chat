const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function getRoom(roomCode) {
    if (!rooms.has(roomCode)) {
        rooms.set(roomCode, {
            users: new Map(),
            messages: []
        });
    }

    return rooms.get(roomCode);
}

function getOnlineUsers(roomCode) {
    const room = rooms.get(roomCode);

    if (!room) return [];

    return [...room.users.values()].map(user => ({
        id: user.id,
        name: user.name
    }));
}

io.on("connection", (socket) => {

    console.log("User connected:", socket.id);

    // JOIN ROOM
    socket.on("joinRoom", ({ roomCode, name }) => {

        if (!roomCode || !name) {
            socket.emit(
                "errorMessage",
                "Name aur Room Code zaroori hai."
            );
            return;
        }

        roomCode = String(roomCode).trim().toUpperCase();
        name = String(name).trim().slice(0, 30);

        if (!name) {
            socket.emit(
                "errorMessage",
                "Valid naam dalo."
            );
            return;
        }

        const room = getRoom(roomCode);

        socket.join(roomCode);

        socket.roomCode = roomCode;
        socket.userName = name;

        room.users.set(socket.id, {
            id: socket.id,
            name: name
        });

        // Purane messages
        socket.emit(
            "messageHistory",
            room.messages
        );

        // Online users
        io.to(roomCode).emit(
            "onlineUsers",
            getOnlineUsers(roomCode)
        );

        // Dusre users ko batana ki naya user online aaya
        socket.to(roomCode).emit(
            "userJoined",
            {
                id: socket.id,
                name: name
            }
        );

        console.log(
            `${name} joined room ${roomCode}`
        );
    });


    // TYPING
    socket.on("typing", () => {

        if (!socket.roomCode) return;

        socket.to(socket.roomCode).emit(
            "userTyping",
            {
                id: socket.id,
                name: socket.userName
            }
        );
    });


    socket.on("stopTyping", () => {

        if (!socket.roomCode) return;

        socket.to(socket.roomCode).emit(
            "userStoppedTyping",
            {
                id: socket.id
            }
        );
    });


    // SEND MESSAGE
    socket.on("sendMessage", (text) => {

        if (!socket.roomCode || !text) return;

        text = String(text).trim();

        if (!text) return;

        text = text.slice(0, 2000);

        const message = {
            id: crypto.randomUUID(),
            senderId: socket.id,
            senderName: socket.userName,
            text: text,
            time: Date.now(),
            status: "sent"
        };

        const room = rooms.get(socket.roomCode);

        if (!room) return;

        room.messages.push(message);

        if (room.messages.length > 500) {
            room.messages.shift();
        }

        // Sabko message
        io.to(socket.roomCode).emit(
            "newMessage",
            message
        );

        // Sender status
        socket.emit(
            "messageStatus",
            {
                messageId: message.id,
                status: "sent"
            }
        );

        // Dusre users ko delivered
        socket.to(socket.roomCode).emit(
            "messageDelivered",
            {
                messageId: message.id
            }
        );

        // Notification event
        socket.to(socket.roomCode).emit(
            "newChatNotification",
            {
                messageId: message.id,
                senderName: socket.userName,
                text: message.text
            }
        );
    });


    // MESSAGE DELIVERED
    socket.on(
        "messageDelivered",
        ({ messageId }) => {

            if (!socket.roomCode) return;

            socket.to(socket.roomCode).emit(
                "messageStatus",
                {
                    messageId,
                    status: "delivered"
                }
            );
        }
    );


    // MESSAGE SEEN
    socket.on(
        "messageSeen",
        ({ messageId }) => {

            if (!socket.roomCode) return;

            socket.to(socket.roomCode).emit(
                "messageStatus",
                {
                    messageId,
                    status: "seen"
                }
            );
        }
    );


    // DELETE MESSAGE FOR EVERYONE
    socket.on(
        "deleteMessageForEveryone",
        ({ messageId }) => {

            if (!socket.roomCode || !messageId) return;

            const room = rooms.get(socket.roomCode);

            if (!room) return;

            const messageIndex =
                room.messages.findIndex(
                    message =>
                        message.id === messageId
                );

            if (messageIndex === -1) return;

            const message =
                room.messages[messageIndex];

            // Sirf message bhejne wala
            // apna message delete kar sakta hai
            if (message.senderId !== socket.id) {
                return;
            }

            room.messages.splice(
                messageIndex,
                1
            );

            io.to(socket.roomCode).emit(
                "messageDeleted",
                {
                    messageId: messageId
                }
            );
        }
    );


    // CLEAR CHAT
    socket.on("clearChat", () => {

        if (!socket.roomCode) return;

        const room =
            rooms.get(socket.roomCode);

        if (!room) return;

        room.messages = [];

        io.to(socket.roomCode).emit(
            "chatCleared"
        );
    });


    // DISCONNECT
    socket.on("disconnect", () => {

        const roomCode =
            socket.roomCode;

        if (!roomCode) {
            console.log(
                "User disconnected:",
                socket.id
            );
            return;
        }

        const room =
            rooms.get(roomCode);

        if (room) {

            room.users.delete(
                socket.id
            );

            io.to(roomCode).emit(
                "userStoppedTyping",
                {
                    id: socket.id
                }
            );

            io.to(roomCode).emit(
                "onlineUsers",
                getOnlineUsers(roomCode)
            );

            // Dusre users ko offline notification
            io.to(roomCode).emit(
                "userLeft",
                {
                    id: socket.id,
                    name: socket.userName
                }
            );

            if (room.users.size === 0) {

                setTimeout(() => {

                    const currentRoom =
                        rooms.get(roomCode);

                    if (
                        currentRoom &&
                        currentRoom.users.size === 0
                    ) {
                        rooms.delete(roomCode);
                    }

                }, 10 * 60 * 1000);
            }
        }

        console.log(
            "User disconnected:",
            socket.id
        );
    });

});


server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "================================"
        );
        console.log(
            " PRIVATE CHAT SERVER STARTED"
        );
        console.log(
            "================================"
        );
        console.log(
            `Port: ${PORT}`
        );
        console.log(
            "Open: http://localhost:3000"
        );
        console.log("");
    }
);
