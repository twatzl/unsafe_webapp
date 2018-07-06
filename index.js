var express = require('express');
var bodyParser = require('body-parser');
var app = express();

var mysql      = require('mysql');
var connection = mysql.createConnection({
  host     : 'localhost',
  user     : 'unsafe_user',
  password : 'password',
  database : 'unsafe_webapp_db'
});

function resetDatabase() {
  let q2 = "create table results (name VARCHAR(255), mail VARCHAR(255), age INT);"

	connection.connect(function (error) {
    connection.query("drop table IF EXISTS results;",
			function (error, results, fields) {
      if (error) { console.error(error); }
    });
    connection.query(q2, function (error, results, fields) {
      if (error) { console.error(error); }
    });
	});
}

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }))

app.use(express.static("static"));

app.get('/api/getdata', function (req, res) {
  res.send('Hello World!');
});

app.get('/api/resetdb', function (req, res) {
  resetDatabase();
  res.send("Database cleaned.");
});

app.post('/api/submitform', function (req, res) {
	let goBackLink = " <a href=\"/\">go back</a>";
	console.log(req.body);

	let name = req.body.name;
	let email = req.body.email;
	let age = req.body.age

	let query = "insert into results (name, mail, age) values (\"" + name + "\", \"" + email + "\", " + age + ");";

	console.log(query);

	connection.query(query, function (error, results, fields) {
		if (error) {
			console.error(error);
			res.send("error occurred");
		} else {
			res.send("ok" + goBackLink);
		}
	});
});

app.get('/listdata', function(req, res) {
	let query = "select * from results;";
	connection.query(query, function (error, results, fields) {
		if (error) {
			console.error(error);
			res.send("error occurred");
		} else {
			res.send(results);
		}
	});
});

app.listen(3000, function () {
  console.log('Web server listening on port 3000!');
});

