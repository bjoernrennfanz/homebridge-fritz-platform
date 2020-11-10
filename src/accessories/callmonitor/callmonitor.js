'use strict';

const Logger = require('../../helper/logger.js');

const fs = require('fs-extra');
const moment = require('moment');

class CallmonitorContactAccessory {

  constructor (api, log, accessory, handler, callmonitor, FakeGatoHistoryService) {
    
    this.api = api;
    this.log = log;
    this.accessory = accessory;
    this.FakeGatoHistoryService = FakeGatoHistoryService;

    this.handler = handler;
    this.client = callmonitor.client;
    
    this.call = {};
    
    this.getService();

  }

  //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~//
  // Services
  //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~//

  getService () {
    
    let service = this.accessory.getService(this.api.hap.Service.ContactSensor);
    
    if(!service){
      Logger.info('Adding Contact service', this.accessory.displayName);
      service = this.accessory.addService(this.api.hap.Service.ContactSensor, this.accessory.displayName, this.accessory.context.config.subtype);
    }
    
    if (!service.testCharacteristic(this.api.hap.Characteristic.LastActivation))
      service.addCharacteristic(this.api.hap.Characteristic.LastActivation);
    
    if (!service.testCharacteristic(this.api.hap.Characteristic.TimesOpened))
      service.addCharacteristic(this.api.hap.Characteristic.TimesOpened);
    
    if (!service.testCharacteristic(this.api.hap.Characteristic.OpenDuration))
      service.addCharacteristic(this.api.hap.Characteristic.OpenDuration);
    
    if (!service.testCharacteristic(this.api.hap.Characteristic.ClosedDuration))
      service.addCharacteristic(this.api.hap.Characteristic.ClosedDuration);

    if (!service.testCharacteristic(this.api.hap.Characteristic.ResetTotal))
      service.addCharacteristic(this.api.hap.Characteristic.ResetTotal);
      
    if(this.accessory.context.config.subtype === 'incoming' && !service.testCharacteristic(this.api.hap.Characteristic.Caller)){
      service.addCharacteristic(this.api.hap.Characteristic.Caller);
    } else if(this.accessory.context.config.subtype === 'outgoing' && !service.testCharacteristic(this.api.hap.Characteristic.Called)){
      service.addCharacteristic(this.api.hap.Characteristic.Called);
    } else if(this.accessory.context.config.subtype === 'group'){
      if(!service.testCharacteristic(this.api.hap.Characteristic.Caller))
        service.addCharacteristic(this.api.hap.Characteristic.Caller);
      if(!service.testCharacteristic(this.api.hap.Characteristic.Called))
        service.addCharacteristic(this.api.hap.Characteristic.Called);
    }
    
    service.getCharacteristic(this.api.hap.Characteristic.ResetTotal)
      .on('set', (value,callback) => {
       
        Logger.info('Resetting FakeGato..', this.accessory.displayName);
        
        const now = Math.round(new Date().valueOf() / 1000); 
        const epoch = Math.round(new Date('2001-01-01T00:00:00Z').valueOf() / 1000);
        
        service.getCharacteristic(this.api.hap.Characteristic.ResetTotal)
          .updateValue(now - epoch);
  
        this.accessory.context.timesOpened = 0;
  
        service.getCharacteristic(this.api.hap.Characteristic.TimesOpened)
          .updateValue(this.accessory.context.timesOpened);
      
        callback(null);
      });
    
    this.historyService = new this.FakeGatoHistoryService('door', this.accessory, {storage:'fs', path: this.api.user.storagePath() + '/fritzbox/'});
    
    service.getCharacteristic(this.api.hap.Characteristic.ContactSensorState)
      .on('change', value => {
        this.handler.change(this.accessory, 'callmonitor', { 
          denyCall: this.denyCall,
          text: this.callerName ? this.callerName + ' (' + this.callerNr + ')' : this.callerNr,
          inbound: this.inbound
        }, this.historyService, value);
      });
    
    this.getState(service);
  
  }
  
  getState(service){
  
    this.client.on('data', async chunk => {
          
      let data = this.parseMessage(chunk);
      
      let text, message;
      
      if(this.accessory.context.config.subtype == 'incoming' || this.accessory.context.config.subtype == 'group'){
      
        if (data[1] === 'ring') {
          
          this.call[data[2]] = {
            type: 'inbound',
            start: data[0],
            caller: data[3],
            called: data[4]
          };
       
          message = {
            time: data[0],
            caller: data[3],
            called: data[4]
          };
          
          text = 'Incoming call from: ' + message.caller + ' to ' + message.called;
          this.callerNr = message.caller;
          this.callerName = false;
          this.denyCall = false;  
          this.inbound = true;
          this.outgoing = false;
          
          this.historyService.addEntry({time: moment().unix(), status: 1});
            
          if(this.accessory.context.config.incomingTo.includes(message.called)){
        
            Logger.debug('"incomingTo" nr matched!', this.accessory.displayName);
              
            let phonebook = false;
              
            try {
            
              await fs.ensureFile(this.api.user.storagePath() + '/fritzbox/phonebook.json');
              phonebook = await fs.readJson(this.api.user.storagePath() + '/fritzbox/phonebook.json', { throws: false });
              
            } catch(err) {
              
              Logger.error('An error occured during reading phonebook!', this.accessory.displayName);
              Logger.error(err);
              
            }
            
            if(phonebook){
              
              for(const entry of phonebook){
           
                let callerToNr = entry.number.find(nr => nr === message.caller);
          
                if(callerToNr){
                  text = 'Incoming call from: ' + entry.name + ' ( '+ entry.number + ' ) to ' + message.called;
                  this.callerName = entry.name;
                  this.callerNr = entry.number;
                }
            
              }
                
            }
            
            let blackbook = false;
              
            try {
              
              await fs.ensureFile(this.api.user.storagePath() + '/fritzbox/blackbook.json');
              blackbook = await fs.readJson(this.api.user.storagePath() + '/fritzbox/blackbook.json', { throws: false });
              
            } catch(err) {
              
              Logger.error('An error occured during reading blackbook!', this.accessory.displayName);
              Logger.error(err);
              
            }
              
            if(blackbook){
              
              for(const entry of blackbook){
         
                let callerToNr = entry.number.find(nr => nr === message.caller);
                
                if(callerToNr)
                  this.denyCall = true;
          
              }
              
            } 
         
            Logger.info(text, this.accessory.displayName);
            
            if(this.denyCall)
              Logger.debug('Blocking Telegram notification for ' + message.caller, this.accessory.displayName);
            
          } else {
         
            Logger.info('"incomingTo" nr not matched. Receiving new call from ' + message.caller + ' to ' + message.called, this.accessory.displayName);
       
          }
              
          service.getCharacteristic(this.api.hap.Characteristic.ContactSensorState)
            .updateValue(1);
            
          service.getCharacteristic(this.api.hap.Characteristic.Caller)
            .updateValue(message.caller);
        
        }
  
      }

      if(this.accessory.context.config.subtype == 'outgoing' || this.accessory.context.config.subtype == 'group'){
      
        if (data[1] === 'call') {
        
          this.call[data[2]] = {
            type: 'outbound',
            start: data[0],
            extension: data[3],
            caller: data[4],
            called: data[5]
          };
        
          message = {
            time: data[0],
            extension: data[3],
            caller: data[4],
            called: data[5]
          };
          
          let called = message.called.replace(/\D/g,''); 
          
          text = 'Outgoing call from: ' + message.caller + ' to ' + message.called;
          this.callerName = false;
          this.callerNr = called;
          this.denyCall = false;  
          this.outgoing = true;
          this.inbound = false;
          
          if(this.accessory.context.config.outgoingFrom.includes(message.caller)){
          
            Logger.debug('"outgoingFrom" nr matched!', this.accessory.displayName);
              
            let phonebook = false;
              
            try {
              
              await fs.ensureFile(this.api.user.storagePath() + '/fritzbox/phonebook.json');
              phonebook = await fs.readJson(this.api.user.storagePath() + '/fritzbox/phonebook.json', { throws: false });
              
            } catch(err) {
              
              Logger.error('An error occured during reading phonebook!', this.accessory.displayName);
              Logger.error(err);
              
            }
            
            if(phonebook){
              
              for(const entry of phonebook){
                
                let callerToNr = entry.number.find(nr => nr === message.caller);
            
                if(callerToNr){
              
                  text = 'Calling ' + entry.name + ' ( '+ entry.number + ' )';
                  this.callerName = entry.name;
                  this.callerNr = entry.number;
              
                }
            
              }
              
            }
          
            let blackbook = false;
              
            try {
              
              await fs.ensureFile(this.api.user.storagePath() + '/fritzbox/blackbook.json');
              blackbook = await fs.readJson(this.api.user.storagePath() + '/fritzbox/blackbook.json', { throws: false });
              
            } catch(err) {
              
              Logger.error('An error occured during reading blackbook!', this.accessory.displayName);
              Logger.error(err);
              
            }
              
            if(blackbook){
              
              for(const entry of blackbook){
                
                let callerToNr = entry.number.find(nr => nr === message.caller);
                
                if(callerToNr)
                  this.denyCall = true;
                  
              }
                
            }
          
            Logger.info(text, this.accessory.displayName);
              
            if(!this.denyCall)
              Logger.debug('Blocking Telegram notification for ' + message.caller, this.accessory.displayName);
        
          } else {
         
            Logger.info('"outgoingFrom" nr not matched. Calling from ' + message.caller + ' to ' + message.called, this.accessory.displayName);
       
          }
          
          service.getCharacteristic(this.api.hap.Characteristic.ContactSensorState)
            .updateValue(1);
          
          service.getCharacteristic(this.api.hap.Characteristic.Called)
            .updateValue(message.called);
     
        }
    
      }

      if (data[1] === 'connect') {
      
        if(this.call[data[2]]){
        
          this.call[data[2]]['connect'] = data[0];
        
          message = {
            time: data[0],
            extension: this.call[data[2]]['extension'],
            caller: this.call[data[2]]['caller'],
            called: this.call[data[2]]['called']
          };
       
          Logger.debug('Connection established from: ' + message.caller + ' - to: ' + message.called, this.accessory.displayName);
      
        }
      
      }

      if (data[1] === 'disconnect') {
          
        if(this.call[data[2]]){
        
          this.call[data[2]].disconnect = data[0];
          this.call[data[2]].duration = parseInt(data[3], 10);
        
          let call = this.call[data[2]];
          delete(this.call[data[2]]);
        
          message = call;
          
          if(this.accessory.context.config.incomingTo.includes(message.called) || this.accessory.context.config.outgoingFrom.includes(message.caller)){
         
            Logger.info('Call disconnected with ' + (this.callerName ? this.callerName + ' (' + this.callerNr + ')' : this.callerNr), this.accessory.displayName);
            
            if(this.denyCall)
              Logger.debug('Blocking Telegram notification for ' + message.caller, this.accessory.displayName);
        
          } else {
        
            Logger.debug((message.type === 'inbound' ? '"incomingTo"' : '"outgoingFrom"') + ' nr not matched. Call disconnected with ' + message.caller, this.accessory.displayName);
       
          }
     
        }
        
        service.getCharacteristic(this.api.hap.Characteristic.ContactSensorState)
          .updateValue(0); 
   
      }
    
    });
      
    this.client.on('error', error => {
        
      Logger.error('An error occured with callmonitor!', this.accessory.displayName);
      console.log(error);
    
    });
  
  }
  
  dateToUnix(string) {
    
    let d = string.match(/[0-9]{2}/g);
    
    let result = '';
    result += '20' + d[2] + '-' + d[1] + '-' + d[0];
    result += ' ' + d[3] + ':' + d[4] + ':' + d[5];
    
    return Math.floor(new Date(result).getTime() / 1000);
 
  }

  parseMessage(buffer) {

    let message = buffer.toString()
      .toLowerCase()
      .replace(/[\n\r]$/, '')
      .replace(/;$/, '')
      .split(';');
    
    message[0] = this.dateToUnix(message[0]);
    
    return message;
  
  }

}

module.exports = CallmonitorContactAccessory;
