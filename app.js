'use strict';

var builder = require('botbuilder');
var getCoords = require('city-to-coords');
var restify = require('restify');
var dateFormat = require('dateformat');
var fs = require('fs');
var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
var ForecastIO = require('forecast-io');
const forecast = new ForecastIO(config.ForecastIOKey);

// setup ConsoleConnector for dev
var connector = new builder.ConsoleConnector().listen();

// Setup Restify Server
// var server = restify.createServer();
// server.listen(process.env.PORT || 3978, function () {
//    console.log('%s listening to %s', server.name, server.url); 
// });
  
// // Create chat bot
// var connector = new builder.ChatConnector({
//     appId: process.env.MICROSOFT_APP_ID || config.MicrosoftAppID,
//     appPassword: process.env.MICROSOFT_APP_PASSWORD || config.MicrosoftAppSecret
// });
// server.post('/api/messages', connector.listen());

var bot = new builder.UniversalBot(connector);
var model = process.env.model || 'https://api.projectoxford.ai/luis/v1/application?id='+config.LUISID+'&subscription-key='+config.LUISKey+'&q=';
var recognizer = new builder.LuisRecognizer(model);
var dialog = new builder.IntentDialog({ recognizers: [recognizer] });
bot.dialog('/', dialog);

dialog.matches('GetWeather', [
    function(session, args) {
        args.forecastType = "GetWeather";
        session.beginDialog('/getWeather', args);
    }
]);

dialog.matches('GetPrecipitation', [
    function(session, args) {
        args.forecastType = "GetPrecipitation";
        session.beginDialog('/getWeather', args);
    }
]);

dialog.onDefault(builder.DialogAction.send("Hello! Try asking me something like, 'How's the weather in San Francisco?' or 'Will it rain in Seattle tomorrow?'"));

bot.dialog('/getWeather', [
    function(session, args, next) {
        var cityEntity = builder.EntityRecognizer.findEntity(args.entities, 'builtin.geography.city');
        var zipCodeEntity = builder.EntityRecognizer.findEntity(args.entities, 'zipCode');
        var locationEntity = builder.EntityRecognizer.findEntity(args.entities, 'location');
        var dateTimeEntity = builder.EntityRecognizer.findEntity(args.entities, 'builtin.datetime.date');

        if(!dateTimeEntity){
            var now = new Date();
            dateFormat(now, "yyyy-mm-dd");
        }
        
        var location;
        if(cityEntity) location = cityEntity;
        else if(zipCodeEntity) location = zipCodeEntity;
        else if(locationEntity) location = locationEntity;

        var weather = session.dialogData.weather = {
          location: location ? location.entity : null,
          dateTime: dateTimeEntity ? dateTimeEntity.resolution.date : dateTime,
          forecastType: args.forecastType ? args.forecastType : null,
        };
        
        if (!weather.location) {
            builder.Prompts.text(session, "I'm sorry. What is the exact location or zip code?");
        } else {
            next();
        }
    },function (session, results, next) {
        var weather = session.dialogData.weather;
        if (results.response) {
            weather.location = results.response;
        }
        if (weather.location) {
            next();
        }
    },function (session, results) {
        var weather = session.dialogData.weather;
        this.weather = weather;
        
        if (weather.location) {
            getCoords(weather.location)
            .then((coords) => {
                forecast
                    .latitude(coords.lat)
                    .longitude(coords.lng)
                    .time(this.weather.dateTime)
                    .get()
                    .then(res => {  
                        var data = JSON.parse(res);
                        switch(this.weather.forecastType){
                            case "GetWeather":
                                var currentlySummary = data.currently.summary;
                                var currentlyTemp = Math.round(data.currently.temperature);
                                var weatherForecast = "Weather is " + currentlySummary.toLowerCase() + ". Temperature is " + currentlyTemp + " Fahrenheit";
                                if(this.weather.dateTime) {
                                    session.send(weatherForecast + " on " + this.weather.dateTime);
                                }
                                else {
                                    session.send("Right now, " + weatherForecast);
                                }
                                break;
                            case "GetPrecipitation":
                                var currentlyPrecipitation = data.currently.precipProbability;
                                var precipForecast = "Chance of precipitation is " + currentlyPrecipitation;
                                if(this.weather.dateTime) {
                                    session.send(precipForecast + '% on ' + this.weather.dateTime);
                                }
                                else {
                                    session.send(precipForecast + '% right now.');
                                }
                                break;
                            default:
                                break;
                        }
                        session.endDialog();
                    }
                );
            });            
        } else {
            session.send('Something went wrong.');
        }
    }
]);
