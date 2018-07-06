const express = require('express');
const bodyParser = require('body-parser');
const app = express();

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

  release () {
    this.connection.release();
    this.connection = null;
  }

  query (sql, args) {
    return new Promise((resolve, reject) => {
      this.connection.query(sql, args, (err, rows, info) => {
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

async function resetDatabase () {
  try {
    const connection = await db.getConnection();

    await connection.query("drop table IF EXISTS results;");
    await connection.query("create table results (name VARCHAR(255), mail VARCHAR(255), age INT);");
    await connection.query("drop table IF EXISTS users;");
    await connection.query("create table users (name VARCHAR(255), password VARCHAR(255), admin INT);");

    connection.release();
  } catch (error) {
    console.error(error);
  }
}

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({extended: false}));

app.use(express.static("static"));

app.get('/api/getdata', function (req, res) {
  res.send('Hello World!');
});

app.get('/api/resetdb', async function (req, res) {
  await resetDatabase()
  res.send("Database cleaned.");
});

app.post('/api/submitform', async function (req, res) {
  let goBackLink = " <a href=\"/\">go back</a>";
  console.log(req.body);

  let name = req.body.name;
  let email = req.body.email;
  let age = req.body.age;

  let q = "insert into results (name, mail, age) values (\"" + name + "\", \"" + email + "\", " + age + ");";

  console.log(q);

  try {
    await db.query(q);

    res.send("ok" + goBackLink);
  } catch (e) {
    console.error(e);
    res.send("error occurred");
  }
});

app.get('/listdata', async function (req, res) {
  let q = "select * from results;";
  try {
    const [results] = await db.query(q);
    res.send(results);
  } catch (error) {
    console.error(error);
    res.send("error occurred");
  }
});

const server = app.listen(3000, function () {
  console.log('Web server listening on port 3000!');
});

server.on('close', async () => {
  try {
    await db.close()
  } catch (error) {
    console.error('failed to close DB pool');
    console.error(error);
  }
})

