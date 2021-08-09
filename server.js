require('dotenv').config();
var process = require('process');
var cors = require('cors');
var express = require('express');
var dayjs = require('dayjs');
var app = express();
var bodyParser = require('body-parser');
var mysql = require('mysql');
const got = require('got');
var axios = require('axios');
// let httpsProxyAgent = require('https-proxy-agent');
// var agent = new httpsProxyAgent('http://myspambox280:Y7u7TfI@176.103.50.237:65233');
const randomUseragent = require('random-useragent');
const promClient = require('prom-client');

app.enable('trust proxy');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));

let td = 0

const instance = axios.create()
const table = process.env.TABLE;

instance.interceptors.request.use((config) => {
    config.headers['request-startTime'] = process.hrtime()
    return config
})

instance.interceptors.response.use((response) => {
    const start = response.config.headers['request-startTime']
    const end = process.hrtime(start)
    const milliseconds = Math.round((end[0] * 1000) + (end[1] / 1000000))
    response.headers['request-duration'] = milliseconds
    return response
})

//cors
/*app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});*/


const register = new promClient.Registry();
register.setDefaultLabels({app: 'rate-back'});

const metrics = {
    showProfiles: new promClient.Counter({
        name: 'show_profile_counter',
        help: 'Profile show counter'
    }),
    rateButton: new promClient.Counter({
        name: 'rate_button_counter',
        help: 'Rate button press counter'
    }),
    pauseButton: new promClient.Counter({
        name: 'pause_button_counter',
        help: 'Pause button press counter'
    }),
    backButton: new promClient.Counter({
        name: 'back_button_counter',
        help: 'Back button press counter'
    }),
    rateButtonGauge: new promClient.Gauge({
        name: 'rate_button_gauge',
        help: 'Rate button press gauge'
    }),
    pauseButtonGauge: new promClient.Gauge({
        name: 'pause_button_gauge',
        help: 'Pause button press gauge'
    }),
    backButtonGauge: new promClient.Gauge({
        name: 'back_button_gauge',
        help: 'Back button press gauge'
    })
};

let rateCounter = 0;
let pauseCounter = 0;
let backCounter = 0;

function incrShowProfileCounter() {
    metrics.showProfiles.inc();

    if (metrics.showProfiles.hashMap[''].value % 1000 === 0) {
        metrics.rateButtonGauge.set(pauseCounter/1000);
        metrics.pauseButtonGauge.set(pauseCounter/1000);
        metrics.backButtonGauge.set(pauseCounter/1000);
        rateCounter = 0;
        pauseCounter = 0;
        backCounter = 0;
    }
}

app.use(cors());

var dbConn;

function handleDisconnect() {
    // db connection
    dbConn = mysql.createConnection({
        host: process.env.SQL_HOST,
        database: process.env.SQL_DATABASE,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        // host: 'database-1.ctsvfjllkr7e.us-east-2.rds.amazonaws.com',
        // database: 'mydb',
        // user: 'admin',
        // password: 'PdOH3ARcmZFklRGY5fLW',
        // socketPath: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`
    });

    dbConn.connect((err) => {
        if (err) {
            console.log(err);
        } else {
            console.log('Connected to database');
        }
    });

    dbConn.on('error', function(err) {
        console.log('db error', err);

        if(err.code === 'PROTOCOL_CONNECTION_LOST') {
            handleDisconnect();
        }else{
            throw err;
        }
    });
}

handleDisconnect();

setInterval(function () {
    dbConn.query('SELECT 1');
}, 5000);

// routes
app.get('/', function (req, res) {
    res.send('Welcome')
})

app.post('/getNextImages', function (req, res) {
    console.log('POST', dayjs().format('mm:ss:SSS'))
    if(req.body.refId!=0){
        dbConn.query(`
            SELECT
                user_id AS authorId, id
            FROM ${table}
            WHERE id > ? AND s3_address <> '0'
            ORDER BY id
            LIMIT 1
            `,
            req.body.refId,
            function (error, results) {
                console.log('GotFromDB', dayjs().format('mm:ss:SSS'))
                processAuthorResponse(res, error, results);
            }
        );
    }
    else{
        dbConn.query(`
            SELECT
                user_id AS authorId, id
            FROM ${table}
            WHERE id > 0 AND s3_address <> '0'
            ORDER BY date
            DESC
            LIMIT 1
            `,
            function (error, results) {
                console.log(results)
                processAuthorResponse(res, error, results);
            }
        );
    }
    incrShowProfileCounter();
});

app.post('/getPrevImages', function (req, res) {
    dbConn.query(`
        SELECT
            user_id AS authorId, id
        FROM ${table}
        WHERE id < ? AND s3_address <> '0'
        ORDER BY id DESC
        LIMIT 1
        `,
        req.body.refId,
        function (error, results) {
            processAuthorResponse(res, error, results);
        }
    );
    metrics.backButton.inc();
});

function processAuthorResponse(res, error, results) {
    if (error) throw error;

    if (results.length == 0)
        return res.send({ data: [] });

    var authorId = results[0].authorId;
    var dbId = results[0].id;
    var totalDone = 1;

    // if (td % 100 == 0) {

    dbConn.query(`
        SELECT COUNT(*) AS count
        FROM ${table}
        WHERE id < ?
        ORDER BY id DESC
        `,
        dbId,
        function (error, results) {
            totalDone = results[0].count;
            // console.log(totalDone);
            console.log('GotTotalDone', dayjs().format('mm:ss:SSS'))
        }
    );

    // }


    // console.log(dbId)
    console.log('GotImagesFromDB', dayjs().format('mm:ss:SSS'))
    var posts = [];

    for(var i = 0 ; i < 12; i ++){
        posts.push({
            totalDone: totalDone,
            dbId: dbId,
            authorId: authorId,
            // postId: results[i].id,
            url: `https://s3.eu-central-1.wasabisys.com/instaloader/${authorId}_${i}.jpg`,
            // url: 'https://cdn3.iconfinder.com/data/icons/diagram_v2/PNG/96x96/diagram_v2-12.png',
        });
    }
    return res.send({data:posts})



};

app.post('/rateImages', function (req, res) {
    dbConn.query(
        `SELECT * FROM ${table} WHERE user_id = ?`,
        req.body.authorId,
        function(error, results){
            if(!error){
                if(result = []){
                    dbConn.query(
                        `UPDATE ${table} SET score = ?, date = now() WHERE user_id = ?`,
                        [req.body.score, req.body.authorId],
                        function (error, results, fields) {
                            // if (error) throw error;
                            console.log("here")
                            console.log(req.body.authorId)
                            return res.send(true);
                        }
                    );
                }
                else{
                    dbConn.query(
                        `UPDATE ${table} SET score = ?, date = now() WHERE user_id = ?`,
                        [req.body.score, req.body.authorId],
                        function (error, results, fields) {
                            if (error) throw error;
                            console.log('done')
                            return res.send(true);
                        }
                    );
                }

            }
        }
    )
    metrics.rateButton.inc();
});

// Pause button  endpoint
app.post('/pauseImages', (req, res) => {
    metrics.pauseButton.inc();
    res.send(true);
});


// Prometheus endpoint
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.send(await promClient.register.metrics());
});

// set port
const port = process.env.PORT || 8080;

app.listen(port, function () {
    console.log('Node app is running on port 8080');
});

process.on('uncaughtException', function(error){
    console.log(error.stack);
});

module.exports = app;
