'use strict';

var text_encoder = new TextEncoder('utf-8');
var text_decoder = new TextDecoder('utf-8');

const vConsole = new VConsole();
//const remoteConsole = new RemoteConsole("http://[remote server]/logio-post");
//window.datgui = new dat.GUI();

var SERVICE_UUID = 'a9d158bb-9007-4fe3-b5d2-d3696a3eb067';
var TX_UUID = '52dc2801-7e98-4fc2-908a-66161b5959b0';
var RX_UUID = '52dc2802-7e98-4fc2-908a-66161b5959b0';

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
// type(1)=TEXT | text(n)
// type(1)=EMPTY

var read_data_array = make_data_array([TYPE.EMPTY]);
var write_data_array = null;
var write_data_length = 0;

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

var vue_options = {
    el: "#top",
    mixins: [mixins_bootstrap],
    data: {
        input_textarea_text: "hello world",
        input_textarea_binary: "",
        file_mimetype: "",
        file_name: "",
        file_size: 0,


        type_select: "TEXT",
        ble_read_text: "",
        ble_read_binary: "",
        ble_read_file: null,

        read_type: TYPE.EMPTY,
        TYPE: TYPE,
        read_text: "",
        read_binary: "",
        read_file: {},
        read_raw: null,
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
                    read_file.file_mimetype = text_decoder.decode(this.read_raw.slice(1 + 4 + binary_length + 2 + name_length + 1, 1 + 4 + binary_length + 2 + name_length + 1 + mime_length));
                    read_file.binary = this.read_raw.slice(1 + 4, 1 + 4 + binary_length);
                    read_file.file_size = read_file.binary.length;
                    this.read_file = read_file;
                    break;
                }
            }
        },

        do_ble_read_text: async function(){
            var array_text = text_encoder.encode(this.ble_read_text);
            var array = new Uint8Array(1 + array_text.length);
            var index = 0;
            array[index++] = TYPE.TEXT;
            array.set(array_text, index);
            index += array_text.length;

            read_data_array = make_data_array(array);
            this.toast_show("送信の準備ができました。");
        },
        do_ble_read_binary: async function(){
            var array_binary = new Uint8Array(this.hex2ba(this.ble_read_binary));
            var array = new Uint8Array(1 + array_binary.length);
            var index = 0;
            array[index++] = TYPE.BINARY;
            array.set(array_binary, index);
            index += array_binary.length;

            read_data_array = make_data_array(array);
            this.toast_show("送信の準備ができました。");
        },
        file_callback: async function(files){
            if( files.length <= 0 )
                return;
            console.log(files);
            this.ble_write_file = files[0];
        },
        do_ble_read_file: async function(files){
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

                read_data_array = make_data_array(array);
                this.toast_show("送信の準備ができました。");
            };
            reader.readAsArrayBuffer(this.ble_write_file);
        },

        do_file_save: function () {
            // var blob = new Blob([this.read_file.binary.buffer], { type: this.read_file.file_mimetype });
            // var url = window.URL.createObjectURL(blob);
      
            // var a = document.createElement("a");
            // a.href = url;
            // a.target = '_blank';
            // a.download = this.read_file.file_name;
            // a.click();
            // window.URL.revokeObjectURL(url);

            window.resolveLocalFileSystemURL(cordova.file.externalRootDirectory + "Download/", (fileSystem) => {
                var options = {
                    exclusive: false,
                    create: true
                };
                fileSystem.getFile(this.read_file.file_name, options, (fileEntry) => {
                    fileEntry.createWriter((fileWriter) => {
                        fileWriter.onwriteend = () => {
                            console.log("Successful file write...");
                            this.toast_show("Downloadフォルダに、" + this.read_file.file_name + " を作成しました。");
                        };

                        fileWriter.onerror = (e) => {
                            console.log("Failed file write: " + e.toString());
                            alert("ファイルを保存できませんでした。");
                        };
                        var dataObj = new Blob([this.read_file.binary.buffer], { type: this.read_file.file_mimetype });
                        fileWriter.write(dataObj);
                    });
                }, (getFileError) => {
                  console.log('getFile failed', getFileError.code);
                  alert("ファイル操作エラー");
                });
            }, (error) => {
                console.log('resolveLocalFileSystemURL failed', error.code);
                alert("ディレクトリ操作エラー");
            });
        },

        store_file: async function(files){
            if( files.length <= 0 )
                return;
            console.log(files);

            let file = files[0];
            let reader = new FileReader();
            reader.onload = e => {
                this.file_mimetype = file.type || "application/octet-stream";
                this.file_name = file.name || "no_titled";
                this.file_size = file.size;

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

                read_data_array = make_data_array(array);
            };
            reader.readAsArrayBuffer(file);
        },
        store_textarea_text: async function(){
            var array_text = text_encoder.encode(this.input_textarea_text);
            var array = new Uint8Array(1 + array_text.length);
            var index = 0;
            array[index++] = TYPE.TEXT;
            array.set(array_text, index);
            index += array_text.length;

            read_data_array = make_data_array(array);
        },
        store_textarea_binary: async function(){
            var array_binary = new Uint8Array(this.hex2ba(this.input_textarea_binary));
            var array = new Uint8Array(1 + array_binary.length);
            var index = 0;
            array[index++] = TYPE.BINARY;
            array.set(array_binary, index);
            index += array_binary.length;

            read_data_array = make_data_array(array);
        },
        request_permissions: async function(){
            if( device.platform == 'Android'){
                cordova.plugins.diagnostic.isBluetoothAvailable((available) =>{
                    console.log("Bluetooth is " + (available ? "available" : "not available"));
                    if( !available ){
                        alert("Bluetoothが有効になっていません。");
                        return;
                    }
                }, (error) =>{
                    console.error("The following error occurred: "+error);
                });
            }
            var permissions = ["BLUETOOTH_ADVERTISE", "BLUETOOTH_CONNECT"];
            cordova.plugins.diagnostic.getBluetoothAuthorizationStatuses((statuses) =>{
                console.log(statuses);
                if( statuses[permissions[0]] != "GRANTED" || statuses[permissions[1] != "GRANTED"] ){
                    cordova.plugins.diagnostic.requestBluetoothAuthorization(() =>{
                        console.log("Bluetooth authorization was requested.");
                        blePeripheral.onWriteRequest(this.didReceiveWriteRequest);
                        this.createService();
                    }, (error) =>{
                        console.error(error);
                    }, permissions);
                }else{
                    blePeripheral.onWriteRequest(this.didReceiveWriteRequest);
                    this.createService();
                }
            }, (error) =>{
                console.error(error);
            });
        },
        reload: async function(){
            location.reload();
        },
        onDeviceReady: async function() {
            this.request_permissions();
        },
        createService: function() {
            // https://learn.adafruit.com/introducing-the-adafruit-bluefruit-le-uart-friend/uart-service
            // Characteristic names are assigned from the point of view of the Central device
    
            var property = blePeripheral.properties;
            var permission = blePeripheral.permissions;
    
            Promise.all([
                blePeripheral.createService(SERVICE_UUID),
                blePeripheral.addCharacteristic(SERVICE_UUID, TX_UUID, property.WRITE, permission.WRITEABLE),
                blePeripheral.addCharacteristic(SERVICE_UUID, RX_UUID, property.READ | property.NOTIFY, permission.READABLE),
                blePeripheral.publishService(SERVICE_UUID),
                blePeripheral.startAdvertising(SERVICE_UUID)
            ]).then(
                function() { console.log ('Created Service'); },
            );
        },
        didReceiveWriteRequest: async function(request) {
            var array = new Uint8Array(request.value);
            var operation = array[0];
            var offset = get_uint32b(array, 1);
            console.log("operation=" + operation + " offset: " + offset + " length=" + array.length);

            if( operation == OPERATION.READ ){
                var whole = new Uint8Array(1 + 4 + (read_data_array.length - offset));
                whole[0] = OPERATION.READ;
                set_uint32b(whole, offset, 1);
                whole.set( read_data_array.slice(offset), 1 + 4);
                await blePeripheral.setCharacteristicValue(SERVICE_UUID, RX_UUID, whole.buffer);
                console.log("setCharacteristicValue");
            }else
            if( operation == OPERATION.WRITE ){
                if( offset == 0 ){
                    write_data_length = get_uint32b(array, 1 + 4);
                    write_data_array = new Uint8Array(4 + write_data_length + 2);
                }
                write_data_array.set(array.slice(1 + 4), offset);
                offset += array.length - (1 + 4);
                if( offset >= (4 + write_data_length + 2) ){
                    var checksum = make_checksum(write_data_array, 0, 4 + write_data_length);
                    if( checksum != get_uint16b(write_data_array, 4 + write_data_length) ){
                        var whole = make_operation_array(OPERATION.ERROR, 0);
                        await blePeripheral.setCharacteristicValue(SERVICE_UUID, RX_UUID, whole.buffer);
                        console.log("setCharacteristicValue");
                        return;
                    }else{
                        var whole = make_operation_array(OPERATION.COMPLETE, offset);
                        await blePeripheral.setCharacteristicValue(SERVICE_UUID, RX_UUID, whole.buffer);
                        console.log("setCharacteristicValue");

                        this.read_raw = write_data_array.slice(4, 4 + write_data_length);
                        this.read_received_date = new Date().getTime();
                        this.parse_read();
                        this.toast_show("データを取得しました。");
                    }
                }else{
                    var whole = make_operation_array(OPERATION.WRITE, offset);
                    await blePeripheral.setCharacteristicValue(SERVICE_UUID, RX_UUID, whole.buffer);
                    console.log("setCharacteristicValue");
                }
            }
        },
    },
    created: function(){
    },
    mounted: function(){
        proc_load();
    }
};
vue_add_data(vue_options, { progress_title: '' }); // for progress-dialog
vue_add_global_components(components_bootstrap);
vue_add_global_components(components_utils);

/* add additional components */
  
window.vue = new Vue( vue_options );

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
