const express = require("express");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5050;

const server = http.createServer(app);

app.use(cors());

// 初始化房间和用户
let connectedUsers = [];
let rooms = [{ id: "123", connectedUsers: 0 }];

// /room-exist/${roomId}
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
        memberId: `member${room.connectedUsers.length}`,
      });
    }
  } else {
    // 房间不存在
    return res.send({ roomExists: false });
  }
});

// socket.io 实例
const io = require("socket.io")(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// 监听端口
server.listen(PORT, () => {
  console.log(`服务器正在${PORT}运行...`);
});
