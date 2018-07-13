'use strict';

(function () {
  let myself = null;

  function csrfToken () {
    return $("meta[name='csrf-token']").attr("content");
  }

  function formatForumPost (data) {
    return '<div class="post">' +
      '<div class="info">' +
      '<div class="msgId">' + data.id + '</div>' +
      '<div class="msgAuthor">' + data.username + '</div>' +
      '<div class="msgTs">' + data.ts + '</div>' +
      '<div class="msgText">' + data.message + '</div>' +
      '</div>' +
      '</div>'
  }


  function createFriendList (data) {
    let tbody = '';
    data.forEach(function (d) {
      tbody += '<tr>';
      tbody += '<td>' + d.name + '</td>';
      tbody += '<td>' + d.mail + '</td>';
      tbody += '<td>' + d.age + '</td>';
      tbody += '</tr>';
    });
    return tbody;
  }

  function showAreas() {
    if (myself && myself.isAdmin) {
      $('#adminArea').css('display', 'block')
    } else {
      $('#adminArea').css('display', '')
    }

    if (myself) {
      $('.forAuth').css('display', 'block')
    } else {
      $('.forAuth').css('display', '')
    }
  }

  $('#login').submit(function (event) {
    event.preventDefault();

    $.ajax({
      method: 'POST',
      url: 'api/login',
      data: {_csrf: $('#login input._csrf').val(), user: $('#login input.user').val(), pw: $('#login input.pw').val()},
      dataType: 'JSON',
    })
      .done(function (data) {
        myself = data;
        showAreas();
      })
  });

  $('#addFriend').submit(function (event) {
    event.preventDefault();

    if (!myself) {
      $('#addFriend .info').text('Not authenticated');
      return;
    }

    let friendName = $('#addFriend input:first').val();
    if (!friendName) {
      $('#addFriend .info').text('Missing friend name');
      return
    }

    $.ajax({
      method: 'POST',
      url: 'api/addFriend',
      headers: {
        'X-CSRF-TOKEN': csrfToken()
      },
      data: {ownId: myself.id, otherName: friendName},
      dataType: 'JSON'
    })
      .done(function (data) {
        $('#addFriend .info').text('success');
      })
      .fail(function (xhr, status, error) {
        $('#addFriend .info').text(status);
      });
  });


  $('#loadOwnFriends').click(function () {
    if (!myself) {
      alert('Not authenticated!');
      return;
    }

    $.ajax({
      method: 'GET',
      url: 'api/getFriends',
      dataType: 'JSON'
    })
      .done(function (data) {
        let tbody = createFriendList(data);

        $('#ownFriendList > tbody').html(tbody);
      })
  });

  $('#loadFriends').click(function () {
    if (!myself) {
      alert('Not authenticated!');
      return;
    }

    let id = $('#personIdForLoadFriends').val();

    $.ajax({
      method: 'GET',
      url: 'api/getFriends/' + id,
      dataType: 'JSON'
    })
      .done(function (data) {
        let tbody = createFriendList(data);

        $('#friendList > tbody').html(tbody);
      })
  });

  $('#postMsg').click(function () {
    let msg = $('#newMsg').val();
    $.ajax({
      method: 'POST',
      url: 'api/addMessage',
      headers: {
        'X-CSRF-TOKEN': csrfToken()
      },
      data: JSON.stringify({message: msg}),
      contentType: 'application/json',
      dataType: 'JSON'
    })
      .done(function (data) {
        $('#forum div:last').append(formatForumPost(data))
      })
      .fail(function (xhr, status) {
        $('#newMsg .info').text('Failed: ' + status);
      })
  });

  // the onLoad trigger
  $(function () {
    $.ajax({
      method: 'GET',
      url: 'api/ownInfo',
      dataType: 'JSON',
    })
      .done(function (data) {
        myself = data;
        showAreas();
      });

    $.ajax({
      method: 'GET',
      url: 'api/messages',
      dataType: 'JSON'
    })
      .done(function (data) {
        let forumHtml = '';
        data.forEach(function (entry) {
          forumHtml += formatForumPost(entry)
        });
        $('#forum').html(forumHtml);
      });
  })

})();

function calculateAge (form) {
  let yearOfBirth = form.yearOfBirth.value;
  let currentYear = (new Date()).getFullYear();
  let expr = currentYear + " - " + yearOfBirth;

  form.age.value = eval(expr);
}