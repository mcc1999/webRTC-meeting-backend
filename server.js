const express = require("express");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5050;

const server = http.createServer(app);

app.use(cors());

// 初始化房间和用户
let rooms = [];

// ================ api ================
// /api/room-exist/${roomId}
app.get("/api/room-exists/:roomId", (req, res) => {
  const { roomId } = req.params;
  const room = rooms.find((r) => r.id === roomId);

  if (room) {
    if (room.connectedUsers.length >= 4) {
      // 房间满员
      return res.send({ roomExists: true, full: true });
    } else {
      // 房间存在，且未满员，可加入
      return res.send({
        roomExists: true,
        full: false,
        // 主持人member0必须在房间，不然房间会销毁，guest进来至少是member1
        memberId: uuidv4(),
      });
    }
  } else {
    // 房间不存在
    return res.send({ roomExists: false });
  }
});
// /api/create-room
app.get("/api/create-room", (req, res) => {
  const roomId = uuidv4();
  const memberId = uuidv4();
  rooms.push({ id: roomId, connectedUsers: [], hostId: memberId });
  return res.send({ roomId, memberId });
});
// /api/member-info/:memberId
app.get("/api/member-info/:memberId", (req, res) => {
  const { memberId } = req.params;
  const roomId = req.query.roomId;
  const room = rooms.find((r) => r.id === roomId);

  if (!room) {
    res.send({ err: "该会议房间不存在!" });
  } else {
    const member = room.connectedUsers.find((m) => m.memberId === memberId);
    if (!member) {
      res.send({ err: "该会议成员不存在!" });
    } else {
      res.send({
        memberInfo: { ...member, isRoomHost: memberId === room.hostId },
      });
    }
  }
});

// ================ socket.io ================
const Topic = {
  CONNECTION: "connection",
  DISCONNECT: "disconnect",
  SEND_CHAT_MESSAGE: "SEND_CHAT_MESSAGE",
  RECEIVE_CHAT_MESSAGE: "RECEIVE_CHAT_MESSAGE",
  SEND_VIDEO_OFFER_ANSWER: "SEND_VIDEO_OFFER_ANSWER",
  RECEIVE_VIDEO_OFFER_ANSWER: "RECEIVE_VIDEO_OFFER_ANSWER",
  SEND_ICE_CANDIDATE: "SEND_ICE_CANDIDATE",
  RECEIVE_ICE_CANDIDATE: "RECEIVE_ICE_CANDIDATE",
  MEMBER_JOIN: "MEMBER_JOIN",
  MEMBER_LEAVE: "MEMBER_LEAVE",
  ROOM_DISBAND: "ROOM_DISBAND",
};

const io = require("socket.io")(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
  allowUpgrades: true, // 确保允许升级连接
  transports: ["polling", "websocket"], // 默认支持这两种传输方式
  connectionStateRecovery: {},
});

io.on(Topic.CONNECTION, (socket) => {
  const { roomId, identify, memberId } = socket.handshake.query;

  const room = rooms.find((r) => r.id === roomId);
  if (!room) {
    console.log("房间" + roomId + "不存在,断开连接");
    socket.disconnect(true);
    return;
  }

  const newUser = {
    roomId,
    memberId,
    socketId: socket.id,
    identify,
  };
  room.connectedUsers.push(newUser);

  console.log("客户端已连接:", socket.id, newUser.memberId, room);

  // 成员wss连接后, 广播成员加入房间
  io.emit(Topic.MEMBER_JOIN, { memberId: newUser.memberId });

  // 聊天消息
  socket.on(Topic.SEND_CHAT_MESSAGE, (data) => {
    console.log("收到聊天消息:", data);
    // 向所有连接的客户端广播消息
    io.emit(Topic.RECEIVE_CHAT_MESSAGE, { ...data, timestamp: Date.now() });
  });

  // 监听客户端发给信令服务器的 Video Offer && Answer
  socket.on(Topic.SEND_VIDEO_OFFER_ANSWER, (data) => {
    const { target, sdp, name } = data;

    const targetSocketId = room.connectedUsers.find(
      (u) => u.memberId === target
    )?.socketId;

    if (targetSocketId) {
      console.log(
        "VIDEO_OFFER_ANSWER",
        name,
        " send ",
        sdp.type === "offer" ? "offer" : "answer",
        " to",
        targetSocketId,
        target
      );
      // 转发给指定客户端
      io.to(targetSocketId).emit(Topic.RECEIVE_VIDEO_OFFER_ANSWER, data);
    }
  });

  // 监听客户端发给信令服务器的 ICE CANDIDATE
  socket.on(Topic.SEND_ICE_CANDIDATE, (data) => {
    const { target } = data;

    const targetSocketId = room.connectedUsers.find(
      (u) => u.memberId === target
    )?.socketId;
    if (targetSocketId) {
      // 转发给指定客户端
      io.to(targetSocketId).emit(Topic.RECEIVE_ICE_CANDIDATE, data);
    }
  });

  // test private chat
  socket.on("PRIVATE_CHAT", (id) => {
    const targetSocketId = room.connectedUsers.find(
      (u) => u.memberId === id
    )?.socketId;

    if (targetSocketId) {
      console.log("PRIVATE_CHAT", " send", " to", targetSocketId);
      // 转发给指定客户端
      io.to(targetSocketId).emit("PRIVATE_CHAT", id);
    }
  });

  // 监听断开连接事件
  socket.on(Topic.DISCONNECT, () => {
    console.log("客户端已断开:", socket.id);

    const disconnectUser = room.connectedUsers.find(
      (u) => u.socketId === socket.id
    );
    io.emit(Topic.MEMBER_LEAVE, { memberId: disconnectUser.memberId });
    room.connectedUsers = room.connectedUsers.filter(
      (user) => user.socketId !== socket.id
    );
    // 主持人离开房间自动解散
    if (disconnectUser.memberId === room.hostId) {
      io.emit(Topic.ROOM_DISBAND);
    }
  });
});

// 监听端口
server.listen(PORT, () => {
  console.log(`服务器正在${PORT}运行...`);
});
