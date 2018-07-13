'use strict';

const secure = !process.argv.includes('--debug');

const baseDir = process.argv.length >= 3 ? process.argv[2] : '/';
const saltRounds = 8;

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const mysql = require('mysql');
const escapeHtml = require('escape-html');
const bcrypt = require('bcrypt');
const uuidv4 = require('uuid/v4')
const fs = require('fs');

const dbConfig = {
  host: 'localhost',
  user: 'unsafe_user',
  password: 'password',
  database: 'unsafe_webapp_db'
};

class Connection {
  constructor (conn) {
    this.connection = conn;
  }

  beginTransaction () {
    return new Promise((resolve, reject) => {
      this.connection.beginTransaction((error) => {
        if (error) {
          return reject(error)
        }
        resolve(this.connection)
      })
    })
  }

  commit () {
    return new Promise((resolve, reject) => {
      this.connection.commit((error) => {
        if (error) {
          this.connection.rollback(() => {
            return reject(error)
          });
          return;
        }
        resolve(this.connection)
      })
    })
  }

  rollback () {
    return new Promise((resolve, reject) => {
      this.connection.rollback((error) => {
        if (error) {
          return reject(error)
        }
        resolve(this.connection)
      })
    })
  }

  release () {
    this.connection.release();
    this.connection = null;
  }

  query (sql, args) {
    return new Promise((resolve, reject) => {
      this.connection.query(sql, args, (err, rows, info) => {
        console.info(sql);
        if (err) {
          return reject(err);
        }

        resolve([rows, info]);
      })
    })
  }
}

class Database {
  constructor (config) {
    this.pool = mysql.createPool(config);
  }

  getConnection () {
    return new Promise((resolve, reject) => {
      this.pool.getConnection((err, connection) => {
        if (err) {
          return reject(err);
        }

        console.info("Opened connection");
        resolve(new Connection(connection))
      })
    })
  }

  query (sql, args) {
    return new Promise((resolve, reject) => {
      this.pool.query(sql, args, (err, rows, info) => {
        if (err)
          return reject(err);
        resolve([rows, info]);
      });
    });
  }

  close () {
    return new Promise((resolve, reject) => {
      this.pool.end(err => {
        if (err)
          return reject(err);
        resolve();
      })
    })
  }
}

let db = new Database(dbConfig);


function checkAuthenticated (req, res, admin) {
  if (req.session && req.session.authInfo && (!admin || req.session.authInfo.isAdmin)) {
    return true;
  } else {
    res.status(401).send('Permission denied');
    return false;
  }
}


async function resetDatabase () {

  try {
    const connection = await db.getConnection();

    await connection.query('drop table IF EXISTS forum;');
    await connection.query('drop table IF EXISTS friends;');
    await connection.query('drop table IF EXISTS user;');
    await connection.query('drop table IF EXISTS person;');


    await connection.query('create table person (' +
      'id INT NOT NULL AUTO_INCREMENT primary key, ' +
      'name VARCHAR(255), ' +
      'mail VARCHAR(255), ' +
      'age INT);');

    await connection.query('create table user (' +
      'username VARCHAR(64) not null primary key, ' +
      'password VARCHAR(255), ' +
      'admin INT, ' +
      'personId INT NOT NULL);');

    await connection.query('create table friends (' +
      'p1 INT NOT NULL, ' +
      'p2 INT NOT NULL, ' +
      'primary key (p1, p2), ' +
      'constraint fk_f1 foreign key (p1) references person(id),' +
      'constraint fk_f2 foreign key (p2) references person(id));');

    await connection.query('create table forum (' +
      'id INT NOT NULL AUTO_INCREMENT primary key,' +
      'username VARCHAR(64) NOT NULL,' +
      'ts DATETIME DEFAULT CURRENT_TIMESTAMP,' +
      'message TEXT,' +
      'constraint fk_author foreign key (username) references user(username)' +
      ');');


    await connection.release();

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(2);
  }
}

function htmlHeaders (res, path) {
  if (path.endsWith('.html')) {
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; script-src 'self'; style-src 'self'; form-action 'self'; connect-src 'self'; frame-ancestors 'none'");
    res.setHeader("X-Frame-Options", "DENY");
  }
}



const app = express();

app.set('trust proxy', 1);
app.use(session({
  name: 'safer',
  secret: 'ourReallyNotSoUnsafeApp', // We now have our own secret
  resave: false,
  saveUninitialized: true,
  cookie: {httpOnly: true, secure: secure}
}));

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({extended: false}));
const jsonParser = bodyParser.json();
app.use(jsonParser);

app.use(express.static("static", {
  setHeaders: htmlHeaders
}));

function requireAuth(req, res, next) {
  if (!checkAuthenticated(req, res)) return;
  next()
}

function requireAdmin(req, res, next) {
  if (!checkAuthenticated(req, res, true)) return;
  next();
}

function checkCSRF(getValue, req, res, next) {
  if (!req.session) {
    res.sendStatus(401);
    return;
  }
  let token = req.session.csrfToken;
  if (!token) {
    console.error('token not initialized!!');
    res.sendStatus(500);
    return;
  }
  if (getValue(req) === token) {
    next();
  } else {
    console.info('- sec - CSRF attack');
    res.status(401).send('Cross site request forbidden');
  }
}

function checkCSRFForm(req, res, next) {
  return checkCSRF(req => req.body && req.body._csrf, req, res, next)
}

function checkCSRFHeader(req, res, next) {
  checkCSRF(req => req.get('X-CSRF-TOKEN'), req, res, next)
}

function isPersonId (input) {
  if (/([1-9][0-9]*)|0/.test(input)) {
    const x = Number(input);
    return x >= 0 && x <= 0x7FFFFFFF;
  }
  return false;
}

const renderHtml = function renderIndexHtml (path, req, res) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = uuidv4();
  }
  fs.readFile(path, function (err, content) {
    if (err) {
      console.error(err);
      res.sendStatus(500);
      return
    }
    htmlHeaders(res, path);
    // this is an extremely simple template engine
    let rendered = content.toString().replace(/\{\{csrfToken\}\}/g, req.session.csrfToken)
    return res.send(rendered);
  });
};

app.get('/', function(req, res) {
  renderHtml('templates/index.html', req, res)
});

app.get('/index.html', function (req, res) {
  renderHtml('templates/index.html', req, res)
});

app.get('/createAccount.html', function (req, res) {
  renderHtml('templates/createAccount.html', req, res)
});


const login = async function login (req, res) {
  let userName = req.body.user;
  let pw = req.body.pw;

  if (!userName) {
    res.sendStatus(400);
    return;
  }

  // we store our passwords unsalted and unhashed as god has intended it.
  try {
    const [result] = await db.query('select u.password, u.admin, u.personId, p.name, p.mail, p.age ' +
      'from user as u inner join person as p on (u.personId = p.id) ' +
      'where u.username = ?;', [userName]);
    if (result.length !== 1) {
      res.status(403).send("Login failed");
      return
    }
    const user = result[0];
    const matches = await bcrypt.compare(pw, user.password);

    if (!matches) {
      // Use same message as when user name does not match
      res.status(403).send("Login failed");
      return;
    }

    console.log(result);
    // noinspection JSUnresolvedVariable
    const authInfo = {
      id: user.personId,
      userName: userName,
      name: user.name,
      mail: user.mail,
      age: user.age,
      isAdmin: user.admin === 1
    };

    req.session.authInfo = authInfo;

    res.json(authInfo);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
};

app.post('/api/login', checkCSRFForm, login);

app.get('/api/getdata', function (req, res) {
  res.send('Hello World!');
});

app.post('/api/resetdb', requireAdmin, checkCSRFHeader, async function (req, res) {
  if (checkAuthenticated(req, res, true)) {
    try {
      await resetDatabase();
      res.send("Database cleaned.");
    } catch (e) {
      console.error(e);
      res.sendStatus(500);
    }
  }
});

app.post('/api/submitform', requireAuth, checkCSRFForm, async function (req, res) {
  let goBackLink = '<a href="' + baseDir + '">go back</a>';
  console.log(req.body);

  let name = req.body.name;
  let email = req.body.mail;
  let age = req.body.age;


  // Fixed SQL Injection #1

  try {
    await db.query('insert into person (name, mail, age) values (?, ?, ?);', [name, email, age]);

    res.send('ok ' + goBackLink);
  } catch (e) {
    console.error(e);
    res.sendStatus(400);
  }
});

const getFriends = async function (req, res, id) {
  // SQL Injection #2
  const [values] = await db.query('select p.id, p.name, p.mail, p.age from person as p, friends as f ' +
    'where (f.p1=? and f.p2=p.id)' +
    ' or (f.p2=? and f.p1=p.id)', [id, id]);

  res.json(values);
};

app.get('/api/getFriends', requireAuth, async function (req, res) {
  const personId = req.session.authInfo.id;
  await getFriends(req, res, personId);
});

app.get('/api/getFriends/:ownId', requireAdmin, async function (req, res) {
  if (!checkAuthenticated(req, res, true)) return;

  const ownId = req.params.ownId;
  if (!isPersonId(ownId)) {
    res.sendStatus(400);
  } else {
    await getFriends(req, res, ownId);
  }
});

async function countFriends (id) {
  return db.query('select count(*) from friends where p1=? or p2=?;', [id, id]);
}


app.get('/api/countFriends/:id', requireAdmin, async function (req, res) {
  if (!checkAuthenticated(req, res)) return;
  const id = req.params.id;
  if (!isPersonId(id)) {
    res.sendStatus(400);
    return;
  }
  try {
    const [count] = await countFriends(id);

    res.json(count['count(*)']);
  } catch (e) {
    res.error(500).json(e)
  }
});

app.post('/api/addFriend', requireAuth, checkCSRFHeader, async function (req, res) {
  const ownId = req.session.authInfo.id;
  let otherId = req.query.otherId;
  const otherName = req.query.otherName;
  try {
    const conn = await db.getConnection();
    if (!otherId) {
      const result = await conn.query('select personId from user where username = ?;', [otherName]);
      console.info('addFriend personId query');
      console.info(result);
      const [[nameQuery]] = result;
      if (nameQuery) {
        otherId = nameQuery.personId;
      } else {
        conn.release();
        res.status(500).send('Unknown user');
        return;
      }
    } else {
      if (!isPersonId(otherId)) {
        res.sendStatus(400);
        return;
      }
    }
    const [[existCount]] = await conn.query('select count(*) from friends where (p1=? and p2=?) or (p2=? and p1=?);', [ownId, otherId, ownId, otherId]);
    if (existCount['count(*)'] === 0) {
      console.info('Adding friend: ' + [ownId, otherId]);
      await conn.query('insert into friends values (?, ?);', [ownId, otherId]);
    } else {
      console.info('Friend already there');
      console.info(existCount);
    }
    conn.release();
    res.json(true)
  } catch (error) {
    console.error(error);
    res.status(500).send('Adding friend failed ' + ownId + ' ' + otherId + ' ' + otherName);
  }
});

app.get('/listdata', requireAuth, async function (req, res) {
  let q = "select * from person;";
  try {
    const [results] = await db.query(q);
    res.json(results);
  } catch (error) {
    console.error(error);
    res.send(500, "error occurred");
  }
});

app.get('/tabledata/:tablename', requireAdmin, async function (req, res) {
  const tablename = req.params.tablename;
  if (!tablename) {
    res.send(400);
    return;
  }


  try {
    const conn = await db.getConnection();
    // I don't think prepared statements can do dynamic table select
    // SQL Injection 3
    const result = await conn.query('select * from ??;', [tablename]);
    conn.release();
    res.json(result[0]);
  } catch (error) {
    console.error(error);
    res.send(500, "error occurred");
  }
});

app.post('/api/createAccount', checkCSRFForm, async function (req, res) {
  const form = req.body;

  if (!form.password || form.password !== form.passwordRepeat) {
    res.status(403).send('Password does not match');
    return;
  }

  if (form.password.length < 8) {
    res.status(403).send('Password too short');
  }

  let con = null;
  try {
    const hashPw = await bcrypt.hash(form.password, saltRounds);
    con = await db.getConnection();
    await con.beginTransaction();
    try {
      const [results] = await con.query('insert into person (name, mail, age) values (?, ?, ?);', [form.name, form.mail, form.age]);
      const personId = results.insertId;
      const isAdmin = personId === 0 ? 1 : 0;
      await con.query('insert into user (username, password, admin, personId) values (?, ?, ?, ?);', [form.userName, hashPw, isAdmin, personId]);
    } catch (error) {
      await con.rollback();
      res.status(400).send(error);
      return
    }

    await con.commit();

    res.redirect(baseDir);

  } catch (error) {
    res.status(500).send(error);
  } finally {
    if (con) con.release();
  }
});

app.get('/api/ownInfo', function (req, res) {
  console.info('ownInfo:');
  console.info(req.session);
  if (req.session && req.session.authInfo) {
    res.json(req.session.authInfo)
  } else {
    res.json(null);
  }
});

app.post('/api/addMessage', requireAuth, checkCSRFHeader, async function (req, res) {
  try {
    const user = req.session.authInfo.userName;
    let text = req.body.message;

    if (!text) {
      res.sendStatus(400);
      return;
    }

    text = escapeHtml(text);

    console.info('Adding forum post');
    console.info(req);

    // XSS #1 pt.1
    let [{insertId: msgId}] = await db.query('insert into forum (username, message) values (?, ?)', [user, text]);

    let [[newEntry]] = await db.query('select * from forum where id = ?', [msgId]);

    res.json(newEntry);

  } catch (e) {
    console.error(e);
    res.status(500).json(e);
  }
});

app.get('/api/messages', async function (req, res) {
  try {
    // XSS #1 pt.2
    let [messages] = await db.query('select * from forum order by ts ASC');
    res.json(messages);
  } catch (e) {
    console.error("Load messages failed");
    console.error(e);
    res.status(500).json(e);
  }
});

app.post('/api/createAdmin', requireAdmin, checkCSRFForm, async function (req, res) {
  if (!checkAuthenticated(req, res, true)) return;
  const userName = req.body.userName;
  if (!userName) {
    res.sendStatus(400);
  } else {
    let conn = null;
    try {
      conn = await db.getConnection();
      await conn.beginTransaction();
      const [result] = await db.query('update user set admin=1 where username=?;', [userName]);
      console.info(result);
      if (result.affectedRows !== 1) {
        await conn.rollback();
        res.status(400).send('Unknown user');
      } else {
        await conn.commit();
        res.json({});
      }
    } catch (e) {
      console.error(e);
      res.sendStatus(500);
    } finally {
      if (conn) conn.release();
    }
  }
});

if (process.argv.includes('--resetDB')) {
  console.log("cleaning database");
  resetDatabase();
} else {
  const server = app.listen(3000, function () {
    console.log('Web server listening on port 3000 with document root ' + baseDir);
  });

  server.on('close', async () => {
    try {
      await db.close()
    } catch (error) {
      console.error('failed to close DB pool');
      console.error(error);
    }
  })
}

