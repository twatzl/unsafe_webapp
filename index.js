'use strict';

const baseDir = process.argv.length >= 3 ? process.argv[2] : '/';

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const mysql = require('mysql');
const dbConfig = {
  host: 'localhost',
  user: 'unsafe_user',
  password: 'password',
  database: 'unsafe_webapp_db',
  multipleStatements: true
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


function checkAuthenticated (req, res) {
  if (!req.session.authInfo) {
    res.status(401).send('Permission denied');
    return false;
  }
  return true;
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

const app = express();

app.use(session({
  secret: 'keyboard cat', // intentionally leave original secret
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, httpOnly: false}
}));

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({extended: false}));
const jsonParser = bodyParser.json();
app.use(jsonParser);

app.use(express.static("static"));


async function login (req, res) {
  let userName = req.body.user;
  let pw = req.body.pw;

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
    if (user.password !== pw) {
      // deliberately use different response on wrong password - maybe a tool detects that
      res.status(403).send("Wrong password");
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
    res.status(500).json(e);
  }
}

app.post('/api/login', login);

app.get('/api/getdata', function (req, res) {
  res.send('Hello World!');
});

app.get('/api/resetdb', async function (req, res) {
  if (checkAuthenticated(req, res) && req.session.authInfo.isAdmin) {
    try {
      await resetDatabase();
      res.send("Database cleaned.");
    } catch (e) {
      res.status(500).send(e);
    }
  }
});

app.post('/api/submitform', async function (req, res) {
  let goBackLink = '<a href="' + baseDir + '">go back</a>';
  console.log(req.body);

  let name = req.body.name;
  let email = req.body.mail;
  let age = req.body.age;

  // SQL Injection #1
  let q = 'insert into person (name, mail, age) values (\'' + name + '\', \'' + email + '\', ' + age + ');';

  console.log(q);

  try {
    await db.query(q);

    res.send('ok ' + goBackLink);
  } catch (e) {
    console.error(e);
    res.status(500).json(e);
  }
});

app.get('/api/getFriends/:ownId', jsonParser, async function (req, res) {
  const ownId = req.params.ownId;

  try {
    // SQL Injection #2
    const [values] = await db.query('select p.id, p.name, p.mail, p.age from person as p, friends as f ' +
      'where (f.p1=' + ownId +
      ' and f.p2=p.id)' +
      ' or (f.p2=' + ownId +
      ' and f.p1=p.id)');

    res.json(values);
  } catch (e) {
    // do not send exception, make it a bit harder to find
    res.status(500).send("error occurred");
  }
});

async function countFriends (id) {
  return db.query('select count(*) from friends where p1=? or p2=?;', [id, id]);
}

app.get('/api/countFriends/:id', jsonParser, async function (req, res) {
  const id = req.params.id;
  try {
    const [count] = await countFriends(id);

    res.json(count['count(*)']);
  } catch (e) {
    res.status(500).json(e)
  }
});

app.get('/api/addFriend', async function (req, res) {
  if (!checkAuthenticated(req, res)) return;

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

app.get('/listdata', async function (req, res) {
  let q = "select * from person;";
  try {
    const [results] = await db.query(q);
    res.json(results);
  } catch (error) {
    console.error(error);
    res.send(500, "error occurred");
  }
});

app.get('/tabledata/:tablename', async function (req, res) {
  const tablename = req.params.tablename;
  if (!tablename) {
    res.send(400);
    return;
  }


  try {
    const conn = await db.getConnection();
    // I don't think prepared statements can do dynamic table select
    // SQL Injection 3
    const query = 'select * from '+ tablename + ';';
    console.log(query);
    const result = await conn.query(query);
    conn.release();
    res.json(result[0]);
  } catch (error) {
    console.error(error);
    res.send(500, "error occurred");
  }
});

app.post('/api/createAccount', async function (req, res) {
  const form = req.body;

  if (!form.password || form.password !== form.passwordRepeat) {
    res.status(403).send('Password does not match');
    return;
  }

  let con = null;
  try {
    con = await db.getConnection();
    await con.beginTransaction();
    try {
      const [results] = await con.query('insert into person (name, mail, age) values (?, ?, ?);', [form.name, form.mail, form.age]);
      const personId = results.insertId;
      await con.query('insert into user (username, password, admin, personId) values (?, ?, ?, ?);', [form.userName, form.password, 0, personId]);
    } catch (error) {
      await con.rollback();
      res.status(500).send(error);
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

app.post('/api/addMessage', async function (req, res) {
  if (!checkAuthenticated(req, res)) return;
  try {
    const user = req.session.authInfo.userName;
    const text = req.body.message;

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

