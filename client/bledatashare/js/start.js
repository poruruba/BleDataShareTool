'use strict';

const vConsole = new VConsole();
//const remoteConsole = new RemoteConsole("http://[remote server]/logio-post");
//window.datgui = new dat.GUI();

var text_encoder = new TextEncoder('utf-8');
var text_decoder = new TextDecoder('utf-8');

const UUID_ANDROID_SERVICE = 'a9d158bb-9007-4fe3-b5d2-d3696a3eb067';
const UUID_ANDROID_WRITE = '52dc2801-7e98-4fc2-908a-66161b5959b0';
const UUID_ANDROID_READ_NOTIFY = '52dc2802-7e98-4fc2-908a-66161b5959b0';

const ANDROID_WAIT = 200;
const BLE_MTU_SIZE = 512;

var bluetoothDevice = null;
var characteristics = new Map();

var read_data_length = 0;
var read_data_buffers = [];
var write_data_array = null;

function make_data_array(data){
    var array = new Uint8Array(4 + data.length + 2);
    var index = 0;
    array[index++] = (data.length >> 24) & 0xff;
    array[index++] = (data.length >> 16) & 0xff;
    array[index++] = (data.length >> 8) & 0xff;
    array[index++] = (data.length >> 0) & 0xff;
    array.set(data, index);
    index += data.length;
    var checksum = make_checksum(array, 0, 4 + data.length);
    array[index++] = (checksum >> 8) & 0xff;
    array[index++] = checksum & 0xff;
//    console.log("length=" + (4 + data.length + 2) + " checksum=" + checksum);

    return array;
}

function make_operation_array(type, length){
    var array = new Uint8Array(1 + 4);
    array[0] = type;
    set_uint32b(array, length, 1);
    return array;
}

var TYPE = {
    EMPTY: 0x00,
    TEXT: 0x01,
    BINARY: 0x02,
    FILE: 0x03,
};

var OPERATION = {
    READ: 0x01,
    WRITE: 0x02,
    COMPLETE: 0x03,
    ERROR: 0xff,
};

// type(1)=FILE | length_of_binary(4)=b | binary(b) | length_of_name(2)=n | name(n) | length_of_mimetype(1)=m | mimetype(m)
// type(1)=TEXT | text
// type(1)=EMPTY

var vue_options = {
    el: "#top",
    mixins: [mixins_bootstrap],
    store: vue_store,
    router: vue_router,
    data: {
        ble_connected: false,
        ble_devicename: '', 
        ble_write_value: '',
        ble_read_value: '',
        ble_notify_value: '',    

        ble_write_binary: null,
        ble_write_text: "",
        ble_write_file: null,

        file_mimetype: "",
        file_name: "",
        file_size: 0,
        
        read_type: TYPE.EMPTY,
        TYPE: TYPE,
        read_text: "",
        read_binary: "",
        read_file: {},
        read_raw: null,

        type_select: "TEXT",
        read_received_date: 0,
    },
    computed: {
        read_type_str: function(){
            switch(this.read_type){
                case TYPE.EMPTY: return "EMPTY";
                case TYPE.TEXT: return "TEXT";
                case TYPE.BINARY: return "BINARY";
                case TYPE.FILE: return "FILE";
            }
        }
    },
    methods: {
        clipboard_copy: function(message){
            this.clip_copy(message);
            this.toast_show('クリップボードにコピーしました。');
        },
        parse_read: async function(){
            this.read_type = this.read_raw[0];
            switch(this.read_type){
                case TYPE.BINARY:{
                    this.read_binary = this.ba2hex(this.read_raw.slice(1), '');
                    break;
                }
                case TYPE.TEXT:{
                    this.read_text = text_decoder.decode(this.read_raw.slice(1));
                    break;
                }
                case TYPE.FILE:{
                    var binary_length = get_uint32b(this.read_raw, 1);
                    var name_length = get_uint16b(this.read_raw, 1 + 4 + binary_length);
                    var mime_length = this.read_raw[1 + 4 + binary_length + 2 + name_length];
                    var read_file = {};
                    read_file.file_name = text_decoder.decode(this.read_raw.slice(1 + 4 + binary_length + 2, 1 + 4 + binary_length + 2 + name_length));
                    read_file.file_mimetype = text_decoder.decode(this.read_raw.slice(1 + 4 + binary_length + 2 + name_length + 2, 1 + 4 + binary_length + 2 + name_length + 1 + mime_length));
                    read_file.binary = this.read_raw.slice(1 + 4, 1 + 4 + binary_length);
                    read_file.file_size = read_file.binary.length;
                    this.read_file = read_file;
                    break;
                }
            }

        },

        do_binary_save: function () {
            var data = new Uint8Array(this.hex2ba(this.read_binary));
            var blob = new Blob([data.buffer], { type: "application/octet-stream" });
            var url = window.URL.createObjectURL(blob);
      
            var a = document.createElement("a");
            a.href = url;
            a.target = '_blank';
            a.download = "notitle.bin";
            a.click();
            window.URL.revokeObjectURL(url);
        },

        do_file_save: function () {
            var blob = new Blob([this.read_file.binary.buffer], { type: this.read_file.file_mimetype });
            var url = window.URL.createObjectURL(blob);
      
            var a = document.createElement("a");
            a.href = url;
            a.target = '_blank';
            a.download = this.read_file.file_name;
            a.click();
            window.URL.revokeObjectURL(url);
        },
      

        do_ble_write_binary: async function(){
            var data = this.hex2ba(this.ble_write_binary);
            var array = new Uint8Array(1 + data.length);
            var index = 0;
            array[index++] = TYPE.BINARY;
            array.set(data, index);
            index += data.length;

            write_data_array = make_data_array(array);
        },
        do_ble_write_text: async function(){
            var array_text = text_encoder.encode(this.ble_write_text);
            var array = new Uint8Array(1 + array_text.length);
            var index = 0;
            array[index++] = TYPE.TEXT;
            array.set(array_text, index);
            index += array_text.length;

            write_data_array = make_data_array(array);
        },
        file_callback: async function(files){
            if( files.length <= 0 )
                return;
            console.log(files);
            this.ble_write_file = files[0];
        },
        do_ble_write_file: async function(files){
            let reader = new FileReader();
            reader.onload = e => {
                this.file_mimetype = this.ble_write_file.type || "application/octet-stream";
                this.file_name = this.ble_write_file.name || "no_titled";
                this.file_size = this.ble_write_file.size;

                var buffer_name = text_encoder.encode(this.file_name);
                var buffer_mimetype = text_encoder.encode(this.file_mimetype);
                var buffer_binary = new Uint8Array(e.target.result);

                var array = new Uint8Array(1 + 4 + buffer_binary.length + 2 + buffer_name.length + 1 + buffer_mimetype.length);
                var index = 0;
                array[index++] = TYPE.FILE;
                array[index++] = (buffer_binary.length >> 24) & 0xff;
                array[index++] = (buffer_binary.length >> 16) & 0xff;
                array[index++] = (buffer_binary.length >> 8) & 0xff;
                array[index++] = (buffer_binary.length >> 0) & 0xff;
                array.set(buffer_binary, index);
                index += buffer_binary.length;
                array[index++] = (buffer_name.length >> 8) & 0xff;
                array[index++] = (buffer_name.length >> 0) & 0xff;
                array.set(buffer_name, index);
                index += buffer_name.length;
                array[index++] = buffer_mimetype.length;
                array.set(buffer_mimetype, index);
                index += buffer_mimetype.length;

                write_data_array = make_data_array(array);
            };
            reader.readAsArrayBuffer(this.ble_write_file);
        },

        do_ble_write: async function(){
            try{
                this.progress_open();
                var whole = new Uint8Array(1 + 4 + write_data_array.length);
                whole[0] = OPERATION.WRITE;
                set_uint32b(whole, 0, 1);
                whole.set(write_data_array, 1 + 4);
                if( write_data_array.length > BLE_MTU_SIZE)
                    return this.writeChar(UUID_ANDROID_WRITE, whole.slice(0, BLE_MTU_SIZE));
                else
                    return this.writeChar(UUID_ANDROID_WRITE, whole);
            }catch(error){
                console.error(error);
                alert(error);
            }finally{
                this.progress_close();
            }
        },
        
        do_ble_read: async function(){
            try{
                this.progress_open();
                read_data_buffers = [];
                read_data_length = 0;
                var whole = make_operation_array(OPERATION.READ, 0);
                await this.writeChar(UUID_ANDROID_WRITE, whole);
            }catch(error){
                this.progress_close();
                console.error(error);
                alert(error);
            }
        },

        ble_connect: async function(){
            try{
                var device = await navigator.bluetooth.requestDevice({
                    filters: [{services:[ UUID_ANDROID_SERVICE ]}]
                });
                console.log("requestDevice OK");

                this.progress_open();

                bluetoothDevice = device;
                bluetoothDevice.addEventListener('gattserverdisconnected', this.onDisconnect);

                this.ble_devicename = bluetoothDevice.name;
                var server = await bluetoothDevice.gatt.connect();
                console.log('Execute : getPrimaryService');
                await wait_async(ANDROID_WAIT);
                var service = await server.getPrimaryService(UUID_ANDROID_SERVICE);
                console.log('Execute : getCharacteristic');
                await this.setCharacteristic(service, UUID_ANDROID_WRITE);
                await this.setCharacteristic(service, UUID_ANDROID_READ_NOTIFY);
                await this.startNotify(UUID_ANDROID_READ_NOTIFY);
                this.ble_connected = true;
                console.log('ble_connect done');
                return bluetoothDevice.name;
            }catch(error){
                alert(error);
            }finally{
                this.progress_close();
            }
        },
        ble_disconnect: async function(){
            if( bluetoothDevice )
                bluetoothDevice.gatt.disconnect();
            this.ble_devicename = "";
        },

        onDisconnect: function(event){
            console.log('onDisconnect: ' + event);
            characteristics.clear();
            this.ble_connected = false;
        },
        onDataChanged: async function(event){
            console.log('onDataChanged');

            let characteristic = event.target;
            console.log("characteristic: " + characteristic.uuid);

            try{
                var buffer = uint8array_to_array(characteristic.value);
                var operation = buffer[0];
                var offset = get_uint32b(buffer, 1);
                if( operation == OPERATION.READ ){
                    if(offset == 0){
                        read_data_length = get_uint32b(buffer, 1 + 4);
                    }
                    read_data_buffers.push(buffer.slice(1 + 4));
                    offset += buffer.length - (1 + 4);
                    if( offset < (4 + read_data_length + 2) ){
                        var whole = make_operation_array(OPERATION.READ, offset);
                        await this.writeChar(UUID_ANDROID_WRITE, whole);
                    }else{
                        var whole_length = read_data_buffers.reduce((sum, buffer) =>{
                            sum += buffer.length;
                            return sum;
                        }, 0);
                        var whole = new Uint8Array(whole_length);
                        read_data_buffers.reduce((index, buffer) =>{
                            whole.set(buffer, index);
                            return index += buffer.length;
                        }, 0);
                        var checksum = make_checksum(whole, 0, 4 + read_data_length);
                        if( checksum != get_uint16b(whole, 4 + read_data_length) ){
                            this.progress_close();
                            return;
                        }
                        this.read_raw = whole.slice(4, 4 + read_data_length);
                        this.read_received_date = new Date().getTime();
                        this.parse_read();
                        this.toast_show("データを取得しました。");
                        this.progress_close();
                    }
                }else
                if( operation == OPERATION.WRITE ){
                    console.log("OPERATION.WRITE offset=", offset);
                    var whole = new Uint8Array(1 + 4 + (write_data_array.length - offset));
                    whole[0] = OPERATION.WRITE;
                    set_uint32b(whole, offset, 1);
                    whole.set(write_data_array.slice(offset), 1 + 4);
                    if( (write_data_array.length - offset) > BLE_MTU_SIZE)
                        return this.writeChar(UUID_ANDROID_WRITE, whole.slice(0, BLE_MTU_SIZE));
                    else
                        return this.writeChar(UUID_ANDROID_WRITE, whole);
                }else
                if( operation == OPERATION.COMPLETE ){
                    console.log("OPERATION.COMPLETE offset=", offset);
                    this.progress_close();
                }else
                if( operation == OPERATION.ERROR ){
                    console.log("OPERATION.ERROR");
                    this.progress_close();
                }
            }catch(error){
                this.progress_close();
                console.error(error);
                alert(error);
            }
        },
        setCharacteristic: function(service, characteristicUuid) {
            console.log('Execute : setCharacteristic : ' + characteristicUuid);

            return wait_async(ANDROID_WAIT)
            .then(() => {
                return service.getCharacteristic(characteristicUuid);
            })
            .then( (characteristic) =>{
                characteristics.set(characteristicUuid, characteristic);
                characteristic.addEventListener('characteristicvaluechanged', this.onDataChanged);
                return service;
            });
        },
        startNotify: function(uuid) {
            if( characteristics.get(uuid) === undefined )
                throw "Not Connected";

            console.log('Execute : startNotifications : ' + uuid);
            return characteristics.get(uuid).startNotifications();
        },
        stopNotify: function(uuid){
            if( characteristics.get(uuid) === undefined )
                throw "Not Connected";

            console.log('Execute : stopNotifications');
            return characteristics.get(uuid).stopNotifications();
        },
        writeChar: function(uuid, array_value) {
            if( characteristics.get(uuid) === undefined )
                throw "Not Connected";

            console.log('Execute : writeValue');
            let data = Uint8Array.from(array_value);
            return characteristics.get(uuid).writeValue(data);
        },
        readChar: async function(uuid){
            if( characteristics.get(uuid) === undefined )
                throw "Not Connected";

            console.log('Execute : readValue');
            var dataView = await characteristics.get(uuid).readValue();
            console.log(dataView);

            return uint8array_to_array(dataView);
        }
    },
    created: function(){
    },
    mounted: function(){
        proc_load();
        
        
        var ary = [];
        for( var i = 0 ; i < 1000 ; i++ )
            ary[i] = i & 0xff;
        this.ble_write_value = this.ba2hex(ary, '');        
    }
};
vue_add_data(vue_options, { progress_title: '' }); // for progress-dialog
vue_add_global_components(components_bootstrap);
vue_add_global_components(components_utils);

/* add additional components */
  
window.vue = new Vue( vue_options );

function uint8array_to_array(array)
{
    var result = new Array(array.byteLength);
    var i;
    for( i = 0 ; i < array.byteLength ; i++ )
        result[i] = array.getUint8(i);

    return result;
}

function wait_async(timeout){
    return new Promise((resolve) =>{
        setTimeout(resolve, timeout);
    });
}

function get_uint16b(uint8array, offset){
    return (uint8array[offset] << 8) | (uint8array[offset + 1] << 0);
}

function get_uint32b(uint8array, offset){
    return (uint8array[offset] << 24) | (uint8array[offset + 1] << 16) | (uint8array[offset + 2] << 8) | (uint8array[offset + 3] << 0);
}

function set_uint32b(uint8array, value, offset){
    uint8array[offset] = (value >> 24) & 0xff;
    uint8array[offset + 1] = (value >> 16) & 0xff;
    uint8array[offset + 2] = (value >> 8) & 0xff;
    uint8array[offset + 3] = (value >> 0) & 0xff;
}

function make_checksum(data, offset, length, init = 0){
    let sum = init;
    for( let i = 0 ; i < length ; i++ )
        sum += data[offset + i];

    return (sum & 0xffff);
}
