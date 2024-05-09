require('dotenv').config(); // 환경변수를 적용하기 위한 코드

const express = require('express');
const app = express(); // express() 함수를 app 이라는 변수에 담아서 앞으로 요소들을 꺼내쓸것임
const port = process.env.PORT;

app.set('view engine', 'ejs'); // ejs 초기 세팅 // ejs 파일이 들어있는 폴더가 기본값으로 됨
app.use(express.static('public')); // 정적파일을 public에 저장하겠다

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // 이 코드와 윗 코드 : body 에 담겨져있는 요소들을 객체형태로 가져오기 위함 (키와 값으로 분리)

const { MongoClient } = require('mongodb');
// mongoDB url을 환경변수로 설정하기
const uri = process.env.MONGODB_URL;
const client = new MongoClient(uri);

const fs = require('fs'); // 파일을 업로드 하기 위한 코드 // 여기서는 이미지파일
const uploadDir = 'public/uploads/'; // 업로드 경로 지정

const multer = require('multer'); // 업로드할 때 필요한 라이브러리
const path = require('path'); // 위와 동일

const bcrypt = require('bcrypt'); // 회원정보 암호화 라이브러리
const saltRounds = 10; // 나중에 환경변수에 넣어서 안전하게 저장하기

// methodOverride
const methodOverride = require('method-override');
app.use(methodOverride('_method'));

// jsonwebtoken
// 로그인을 성공했을 때 토큰 발행 (어떤 정보를 넣어서 발행할지 결정할 수 있음)
// 쿠키에 토큰 저장
// 토큰 정보를 header.ejs 에 반영
// 로그아웃 했을 때 쿠키 삭제
const jwt = require('jsonwebtoken');
const SECRET = process.env.SECRET_KEY;

// cookie-parser
// 쿠키 파싱
// 쿠키 생성 및 삭제
// 쿠키를 데이터에 저장
const cookieParser = require('cookie-parser'); // 라이브러리 불러오기
const { error } = require('console');
app.use(cookieParser()); // 미들웨어로 등록

// 모든 요청에 대해 쿠키를 검사하는 기능
// 토큰이 있다면 토큰을 해독해서 req.s=user 에 userid 를 생성
app.use(async (req, res, next) => {
  const token = req.cookies.token;
  if (token) {
    // true 로그인 됨을 의미
    try {
      const data = jwt.verify(token, SECRET);
      const db = await getDB();
      const user = await db.collection('users').findOne({ userid: data.userid });
      req.user = user ? user : null;
    } catch (e) {
      console.error(e);
    }
  }
  next();
});

// 부모 디렉토리가 존재하지 않을 경우, 상위 디렉토리도 함께 생성할 수 있도록 설정
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const getDB = async () => {
  await client.connect();
  return client.db('blog');
};

app.get('/', async (req, res) => {
  try {
    const db = await getDB();
    const posts = await db.collection('posts').find().sort({createAtDate:-1}).toArray();
    res.render('index', { posts, user: req.user }); // {posts: posts} 축약
  } catch (e) {
    console.log(e);
  }
});

// 글작성페이지
app.get('/write', (req, res) => {
  res.render('write', { user: req.user }); // 따로 '/' 경로를 쓰지 않아도 됨 // 확장자는 생략 가능함. 모든 확장자를 ejs 로 쓸 것이기 때문에
});

// 3개씩 추가되는 포스트 갖고오는 기능 // 무한 스크롤
app.get('/getPosts', async (req, res) => {
  const page = req.query.page || 1;
  // const postsPerPage = req.query.postsPerPage || 3
  const postsPerPage = 3;
  const skip = (page - 1) * postsPerPage // 1:0, 2:3

  try{
    const db = await getDB();
    const posts = await db.collection('posts')
      .find()
      .sort({createAtDate: -1})
      .skip(skip)
      .limit(postsPerPage)
      .toArray()
    res.json(posts)
  } catch(e){
    console.error(e);
  }
})

// Multer 설정
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // 파일이 저장될 경로를 지정
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname)); // 파일 이름 설정
  },
});

const upload = multer({ storage: storage });

// 글작성기능
app.post('/write', upload.single('postimg'), async (req, res) => {
  const { title, content } = req.body;
  const postImg = req.file ? req.file.filename : null;
  const createAtDate = new Date();

  try {
    const db = await getDB();
    const result = await db.collection('counter').findOne({ name: 'counter' });
    await db.collection('posts').insertOne({
      _id: result.totalPost + 1,
      title,
      content,
      createAtDate,
      userid: req.user.userid, // 게시물 검사용
      username: req.user.username, // 닉네임 표시용
      postImgPath: postImg ? `/uploads/${postImg}` : null, // 이미지 저장 경로 지정 주의 '/'
    });
    await db.collection('counter').updateOne({ name: 'counter' }, { $inc: { totalPost: 1 } });

    // 좋아요 기본값 세팅
    await db.collection('like').insertOne({
      post_id: result.totalPost + 1,
      likeTotal: 0,
      likeMember: [],
    });

    res.redirect('/');
  } catch (error) {
    console.log(error);
  }
});

// 댓글기능개발 /comment/9
app.post('/comment/:id', async (req, res) => {
  const post_id = parseInt(req.params.id);
  const { comment } = req.body; // 'req.body.comment 를 comment 라는 변수로 담을 것이다' 의 축약본
  const createAtDate = new Date();

  try {
    const db = await getDB();
    await db.collection('comment').insertOne({ post_id, comment, createAtDate, userid: req.user.userid, username: req.user.username });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.json({ success: false });
  }
});

// 상세페이지
app.get('/detail/:id', async (req, res) => {
  let id = parseInt(req.params.id);
  try {
    const db = await getDB();
    const posts = await db.collection('posts').findOne({ _id: id });
    const like = await db.collection('like').findOne({ post_id: id });
    const comments = await db.collection('comment').find({ post_id: id }).sort({ createAtDate: -1 }).toArray();
    res.render('detail', { posts, user: req.user, like, comments });
  } catch (e) {
    console.error(e);
  }
});

// 삭제기능
app.post('/delete/:id', async (req, res) => {
  let id = parseInt(req.params.id);
  try {
    const db = await getDB();
    await db.collection('posts').deleteOne({ _id: id });
    res.redirect('/');
  } catch (e) {
    console.error(e);
  }
});

// 수정페이지
app.get('/edit/:id', async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const db = await getDB();
    const posts = await db.collection('posts').findOne({ _id: id });
    res.render('edit', { posts, user: req.user });
  } catch (error) {
    console.log(error);
  }
});

// 수정기능
app.post('/edit', upload.single('postimg'), async (req, res) => {
  const { id, title, content, createAtDate } = req.body;
  const postimgOld = req.body.postimgOld.replace('uploads/', '');
  const postImg = req.file ? req.file.filename : postimgOld;

  try {
    const db = await getDB();
    await db.collection('posts').updateOne(
      { _id: parseInt(id) },
      {
        $set: {
          title,
          content,
          createAtDate,
          postImgPath: postImg ? `/uploads/${postImg}` : null,
        },
      } // updateOne({ 찾을 값 }, { 바꿀 값 })
    );
    res.redirect('/');
  } catch (error) {
    console.log(error);
  }
});

// 회원가입 페이지
app.get('/signup', (req, res) => {
  res.render('signup', { user: req.user });
});

// 회원가입 기능
app.post('/signup', async (req, res) => {
  const { userid, pw, username } = req.body;
  console.log('가입 정보 확인', req.body);

  try {
    const hashedPw = await bcrypt.hash(pw, saltRounds); // 비밀번호 암호화
    const db = await getDB();
    await db.collection('users').insertOne({ userid, username, pw: hashedPw }); // mongoDB 에 users라는 콜렉션이 자동으로 생성됨
    res.redirect('/login');
  } catch (e) {
    console.error(e);
  }
});

// 로그인 페이지
app.get('/login', (req, res) => {
  res.render('login', { user: req.user });
});

// 로그인 기능
app.post('/login', async (req, res) => {
  const { userid, pw } = req.body;

  try {
    const db = await getDB();
    const user = await db.collection('users').findOne({ userid });
    console.log('로그인 데이터 ---', req.body, user);

    if (user) {
      const compareResult = await bcrypt.compare(pw, user.pw);
      if (compareResult) {
        // 로그인 성공
        const token = jwt.sign({ userid: user.userid }, SECRET); // 웹토큰 발행
        res.cookie('token', token);
        res.redirect('/');
      } else {
        // 비밀번호가 맞지 않을 경우
        res.status(401).send(); // send 는 간단한 문장을 보낼 때 사용된다
      }
    } else {
      // 아이디가 맞지 않을 경우
      res.status(404).send();
    }
  } catch (e) {
    console.error(e);
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
});

// 개인페이지
app.get('/personal/:userid', async (req, res) => {
  const postUser = req.params.userid;

  try {
    const db = await getDB();
    const posts = await db.collection('posts').find({ userid: postUser }).toArray();
    // console.log(postUser, posts);
    res.render('personal', { posts, user: req.user, postUser });
  } catch (e) {
    console.error(e);
  }
});

// 마이페이지
app.get('/mypage', (req, res) => {
  console.log(req.user);
  res.render('mypage', { user: req.user });
});

// 좋아요 기능
app.post('/like/:id', async (req, res) => {
  const postid = parseInt(req.params.id); // 포스트 아이디
  const userid = req.user.userid; // 로그인된 사용자

  try {
    const db = await getDB();
    const like = await db.collection('like').findOne({ post_id: postid });
    if (like.likeMember.includes(userid)) {
      // 이미 좋아요를 누른 경우
      await db.collection('like').updateOne(
        { post_id: postid },
        {
          $inc: { likeTotal: -1 },
          $pull: { likeMember: userid }, // likeMember 항목에서 userid 삭제
        }
      );
    } else {
      // 좋아요를 처음 누르는 경우
      await db.collection('like').updateOne(
        { post_id: postid },
        {
          $inc: { likeTotal: 1 },
          $push: { likeMember: userid }, // likeMember 항목에서 userid 추가
        }
      );
    }
    res.redirect('/detail/' + postid);
  } catch (e) {
    console.error(e);
  }
});

app.listen(port, () => {
  console.log(`잘 돌아감 --- ${port}`);
});
