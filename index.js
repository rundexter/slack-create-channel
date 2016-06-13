var _           = require('lodash')
  , agent       = require('superagent')
  , q           = require('q')
  , baseUrl     = 'https://slack.com/api/'
;

module.exports = {
    /**
     * Allows the authenticating users to follow the user specified in the ID parameter.
     *
     * @param {AppStep} step Accessor for the configuration for the step using this module.  Use step.input('{key}') to retrieve input data.
     * @param {AppData} dexter Container for all data used in this workflow.
     */
    run: function(step, dexter) {
        try {
            var names = step.input('name')
              , token = dexter.provider('slack').credentials('access_token')
              , self  = this
              , url   = baseUrl + 'channels.create'
              , promises = []
              , req 
            ;

            _.each(names, function(name) {
                req = agent.post(url)
                        .type('form')
                        .send(_.extend({token: token, name: name }))
                ;
                
                promises.push(
                    promisify(req, 'end', 'body.channel')
                      .catch(self.recover.bind(self, token, name))
                );
            });
            q.all(promises)
              .then(this.complete.bind(this))
              .catch(this.fail.bind(this))
            ;
        } catch(e) {
          console.log('Error initializing action');
          this.fail(e);
        }
    }

    /**
     *  Try and recover from an error creating the channel or just fail
     *
     *  @param { String } token - the slack token
     *  @param { String } name  - the channel name
     *  @param { Error  } err   - the error that occurred
     *
     *  @returns if error is handled, a promise
     *  @throws the error is not handled, throws the error
     */
    , recover: function(token, name, err) {
        var self = this
          //Slack translates improper names to match [a-z0-9-_]
          , fixedName = name.toLowerCase().replace(/[^\w\d-_]/g, '_')
        ;
        if(err.error === 'name_taken') {
          return promisify(
            agent.post(baseUrl+'channels.list')
                .type('form')
                .send({token: token})
            , 'end', 'body.channels'
          ).then(function(channels) {
            var channel = _.find(channels, { name: fixedName });
            if(channel) {
                //unarchive the channel, if needed
                if(channel.is_archived) {
                    self.log('Channel ' + name + ' (' + fixedName + ') exists and was archived - unarchiving');
                    return promisify(
                        agent.post(baseUrl+'channels.unarchive')
                          .type('form')
                          .send({token: token, channel: channel.id}) 
                        , 'end'
                    ).then(function(body) {
                        return channel;
                    });

                }
                self.log('Channel ' + name + ' (' + fixedName + ') already exists and is unarchived - no need to do anything!');
                return channel;
            } else {
                self.log('Could not find channel ' + name + ' (' + fixedName + '), but Slack reported it as already existing.  Not sure what to do.');
                throw err;
            }
          });
        } 

        //if we haven't handled the error, throw it
        throw err;
    }
};

function promisify(scope, call, path) {
    var deferred = q.defer(); 

    scope[call](function(err, result) {
        return err || !_.get(result,'body.ok')
          ? deferred.reject(err || result.body)
          : deferred.resolve(_.get(result, path))
        ;
    });

    return deferred.promise;
}
