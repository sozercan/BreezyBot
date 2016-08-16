'use strict';

var builder = require('botbuilder');
var getCoords = require('city-to-coords');
var restify = require('restify');
var fs = require('fs');
var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
var ForecastIO = require('forecast-io');

var forecastIOKey = process.env.FORECASTIO_KEY || config.ForecastIOKey;
const forecast = new ForecastIO(forecastIOKey);

// setup ConsoleConnector for local dev
//var connector = new builder.ConsoleConnector().listen();

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});
  
// Create chat bot
var connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID || config.MicrosoftAppID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD || config.MicrosoftAppSecret
});
server.post('/api/messages', connector.listen());

var bot = new builder.UniversalBot(connector);
var model = process.env.model || 'https://api.projectoxford.ai/luis/v1/application?id='+config.LUISID+'&subscription-key='+config.LUISKey+'&q=';
var recognizer = new builder.LuisRecognizer(model);
var dialog = new builder.IntentDialog({ recognizers: [recognizer] });
bot.dialog('/', dialog);

dialog
    .matches('GetWeather', [
        function(session, args) {
            args.forecastType = "GetWeather";
            session.beginDialog('/getWeather', args);
        }])
    .matches('GetPrecipitation', [
        function(session, args) {
            args.forecastType = "GetPrecipitation";
            session.beginDialog('/getWeather', args);
        }])
    .matches('ChangeLocation', [
        function(session, args) {
            args.forecastType = null;
            session.beginDialog('/getWeather', args);
        }])
    .matches('ChangeTempType', [
        function(session, args) {
            args.tempType = null;
            session.beginDialog('/getWeather', args);
        }])
    .onDefault(builder.DialogAction.send("Hello! Try asking me something like, 'How's the weather in San Francisco?' or 'Will it rain in Seattle tomorrow?'"));

bot.dialog('/getWeather', [
    function(session, args, next) {
        var cityEntity = builder.EntityRecognizer.findEntity(args.entities, 'builtin.geography.city');
        var zipCodeEntity = builder.EntityRecognizer.findEntity(args.entities, 'zipCode');
        var locationEntity = builder.EntityRecognizer.findEntity(args.entities, 'location');
        var dateTimeEntity = builder.EntityRecognizer.findEntity(args.entities, 'builtin.datetime.date');
        var tempTypeEntity = builder.EntityRecognizer.findEntity(args.entities, 'tempType');

        var location;
        if(cityEntity) location = cityEntity;
        else if(zipCodeEntity) location = zipCodeEntity;
        else if(locationEntity) location = locationEntity;

        var weather = session.dialogData.weather = {
          location: location ? location.entity : null,
          dateTime: dateTimeEntity ? dateTimeEntity.resolution.date : null,
          forecastType: args.forecastType ? args.forecastType : session.userData.forecastType.slice(-1)[0],
          tempType: tempTypeEntity ? tempTypeEntity.entity : session.userData.tempType,
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
                                var currentlyTemp;
                                var currentlyTempC = Math.round((data.currently.temperature - 32) * 5 / 9);
                                var currentlyTempF = Math.round(data.currently.temperature);

                                switch(this.weather.tempType) {
                                    case "celsius":
                                        currentlyTemp = currentlyTempC;
                                        session.userData.tempType = "celsius";
                                        break;
                                    case "fahrenheit":
                                    default:
                                        currentlyTemp = currentlyTempF;
                                        session.userData.tempType = "fahrenheit";
                                        break;
                                }

                                var weatherForecast = "condition is " + currentlySummary.toLowerCase() + " in " + this.weather.location + ". Temperature is " + currentlyTemp + " " + session.userData.tempType;
                                if(this.weather.dateTime) {
                                    session.send(weatherForecast + " on " + this.weather.dateTime);
                                } else {
                                    session.send("Right now, " + weatherForecast);
                                }
                                break;
                            case "GetPrecipitation":
                                var currentlyPrecipitation = data.currently.precipProbability;
                                var precipForecast = "Chance of precipitation is " + currentlyPrecipitation;
                                if(this.weather.dateTime) {
                                    session.send(precipForecast + '% on ' + this.weather.dateTime);
                                } else {
                                    session.send(precipForecast + '% right now.');
                                }
                                break;
                            default:
                                break;
                        }
                        
                        if (!session.userData.location) {
                            session.userData.location = [this.weather.location];
                        } else {
                            session.userData.location.push(this.weather.location);
                        }

                        if (!session.userData.forecastType) {
                            session.userData.forecastType = [this.weather.forecastType];
                        } else {
                            session.userData.forecastType.push(this.weather.forecastType);
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
